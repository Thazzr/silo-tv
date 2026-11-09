import type { KeyValueStore } from '../../platform';

/**
 * Profile at launch: whether the app reopens the profile used last or asks "Who's watching?".
 * This is a device setting kept per server in the platform storage; it is never sent to the server.
 */
export const LAUNCH_MODES = ['automatic', 'every', 'hour', 'halfday'] as const;
export type LaunchMode = (typeof LAUNCH_MODES)[number];

/** A new TV asks every time; the app offers Automatic once after the first pick. */
export const DEFAULT_LAUNCH_MODE: LaunchMode = 'every';

const HOUR_MS = 3_600_000;
/** How long the app may have been unused before a timed mode shows the picker again. */
export const LAUNCH_LIMIT_MS: Readonly<Partial<Record<LaunchMode, number>>> = {
  hour: HOUR_MS,
  halfday: 12 * HOUR_MS,
};

export interface LaunchRecord {
  mode: LaunchMode;
  /** The profile chosen last on this device for this server; the picker starts on it. */
  lastProfileId: string | null;
  /** Whether that profile has a PIN: such a profile is never opened without asking for it. */
  lastProfileHasPin: boolean;
  /** Epoch milliseconds of the last use with a profile open; null before the first pick. */
  lastUsedAt: number | null;
  /** The "Open automatically?" question was shown (or answered through the menu) already. */
  offered: boolean;
}

const EMPTY: LaunchRecord = {
  mode: DEFAULT_LAUNCH_MODE,
  lastProfileId: null,
  lastProfileHasPin: false,
  lastUsedAt: null,
  offered: false,
};

// Bump when the stored shape changes; an unknown version reads as a new TV.
const STORAGE_KEY = 'silo-tv.profileLaunch.v1';

function storageKey(origin: string): string {
  return `${STORAGE_KEY}.${origin}`;
}

function parse(raw: string | null): LaunchRecord {
  if (!raw) return EMPTY;
  try {
    const parsed = JSON.parse(raw) as { v?: unknown; record?: Partial<LaunchRecord> };
    const r = parsed.record;
    if (parsed.v !== 1 || !r || typeof r !== 'object') return EMPTY;
    return {
      mode: (LAUNCH_MODES as readonly unknown[]).includes(r.mode)
        ? (r.mode as LaunchMode)
        : DEFAULT_LAUNCH_MODE,
      lastProfileId: typeof r.lastProfileId === 'string' ? r.lastProfileId : null,
      lastProfileHasPin: r.lastProfileHasPin === true,
      lastUsedAt: typeof r.lastUsedAt === 'number' ? r.lastUsedAt : null,
      offered: r.offered === true,
    };
  } catch {
    return EMPTY;
  }
}

/**
 * Whether a launch (or a change of server) shows the picker instead of reopening the last profile.
 * A timed mode compares the time since the last use with its limit: exactly the limit still
 * reopens, anything longer asks. A clock that reads earlier than the last use asks too, as the
 * elapsed time cannot be trusted then.
 */
export function shouldShowPicker(record: LaunchRecord, now: number): boolean {
  if (!record.lastProfileId) return true;
  // A PIN profile never opens by itself; the picker starts on it and asks for the PIN.
  if (record.lastProfileHasPin) return true;
  if (record.mode === 'automatic') return false;
  const limit = LAUNCH_LIMIT_MS[record.mode];
  if (limit === undefined) return true;
  if (record.lastUsedAt === null) return true;
  const elapsed = now - record.lastUsedAt;
  return elapsed < 0 || elapsed > limit;
}

/** The launch records of all servers, read lazily from the storage and cached. */
export class ProfileLaunchPrefs {
  private readonly cache = new Map<string, LaunchRecord>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly storage: KeyValueStore | null,
    private readonly now: () => number = Date.now,
  ) {}

  /** The same object until the record changes, so `useSyncExternalStore` can compare it. */
  get(origin: string): LaunchRecord {
    let record = this.cache.get(origin);
    if (!record) {
      record = parse(this.storage?.get(storageKey(origin)) ?? null);
      this.cache.set(origin, record);
    }
    return record;
  }

  shouldShowPicker(origin: string): boolean {
    return shouldShowPicker(this.get(origin), this.now());
  }

  /** Choosing a mode answers the "Open automatically?" question too. */
  setMode(origin: string, mode: LaunchMode): void {
    this.apply(origin, { mode, offered: true });
  }

  /** The viewer chose (or the app opened) a profile: remember it and stamp the use. */
  recordPick(origin: string, profile: { id: string; has_pin: boolean }): void {
    this.apply(origin, {
      lastProfileId: profile.id,
      lastProfileHasPin: profile.has_pin,
      lastUsedAt: this.now(),
    });
  }

  /** Stamps the use while a profile is open; before the first pick there is nothing to stamp. */
  touch(origin: string): void {
    if (!this.get(origin).lastProfileId) return;
    this.apply(origin, { lastUsedAt: this.now() });
  }

  markOffered(origin: string): void {
    if (this.get(origin).offered) return;
    this.apply(origin, { offered: true });
  }

  /** Forgets everything about a server that was removed from this TV. */
  clear(origin: string): void {
    this.cache.set(origin, EMPTY);
    this.storage?.remove(storageKey(origin));
    this.emit();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private apply(origin: string, patch: Partial<LaunchRecord>): void {
    const next = { ...this.get(origin), ...patch };
    this.cache.set(origin, next);
    this.storage?.set(storageKey(origin), JSON.stringify({ v: 1, record: next }));
    this.emit();
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
