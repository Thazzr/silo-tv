import { Session, sessionStorageKey } from '../../api/session';
import { hostOf } from '../../features/branding/branding';
import { getPlatform, type KeyValueStore } from '../../platform';

/** One server the user added. */
export interface SavedServer {
  origin: string;
  /** The server's own name from its branding; the host until the branding was seen once. */
  name: string;
  /** Epoch milliseconds of the last time the user opened this server; the newest is "current". */
  lastUsedAt: number;
}

// Bump when the stored shape changes; an unknown version reads as "no servers".
const STORAGE_KEY = 'silo-tv.servers.v1';

// Keys of the single-server app. The app is unreleased, so they are dropped, not migrated.
const LEGACY_KEYS = ['silo-tv.server.v1', 'silo-tv.session.v1'];

function isSavedServer(value: unknown): value is SavedServer {
  if (value === null || typeof value !== 'object') return false;
  const s = value as Partial<SavedServer>;
  return (
    typeof s.origin === 'string' &&
    s.origin !== '' &&
    typeof s.name === 'string' &&
    typeof s.lastUsedAt === 'number'
  );
}

/**
 * The servers the user added and one Session per server origin. Each session lives under its own
 * storage key, so signing out of one server never touches another. The current server is the one
 * used last; the list shows it first.
 */
export class ServerRegistry {
  private servers: SavedServer[];
  private readonly sessions = new Map<string, Session>();
  private readonly listeners = new Set<() => void>();
  // The sorted list is rebuilt only when something changed, so a React subscription can compare it.
  private snapshot: SavedServer[] = [];

  constructor(
    private readonly storage: KeyValueStore | null = getPlatform().storage,
    private readonly now: () => number = Date.now,
  ) {
    for (const key of LEGACY_KEYS) storage?.remove(key);
    this.servers = this.load();
    this.rebuild();
  }

  /** The saved servers, the current one first, then by last use. */
  list(): SavedServer[] {
    return this.snapshot;
  }

  /** The server used last, or null without any. */
  current(): SavedServer | null {
    return this.snapshot[0] ?? null;
  }

  get(origin: string): SavedServer | null {
    return this.servers.find((s) => s.origin === origin) ?? null;
  }

  /** Saves a server, or marks an already saved one as used; it becomes the current server. */
  add(origin: string, name?: string): SavedServer {
    const existing = this.get(origin);
    if (existing) {
      this.apply(
        this.servers.map((s) =>
          s === existing ? { ...s, name: name ?? s.name, lastUsedAt: this.stamp() } : s,
        ),
      );
    } else {
      this.apply([
        ...this.servers,
        { origin, name: name ?? hostOf(origin), lastUsedAt: this.stamp() },
      ]);
    }
    return this.get(origin)!;
  }

  /** Marks a saved server as used, which makes it the current one. */
  touch(origin: string): void {
    if (!this.get(origin)) return;
    this.apply(
      this.servers.map((s) => (s.origin === origin ? { ...s, lastUsedAt: this.stamp() } : s)),
    );
  }

  /** Updates the name shown for a server (from its branding); the order does not change. */
  rename(origin: string, name: string): void {
    const existing = this.get(origin);
    if (!existing || existing.name === name || !name.trim()) return;
    this.apply(this.servers.map((s) => (s === existing ? { ...s, name } : s)));
  }

  /** Forgets a server and deletes its session. Signing out on the server is the caller's job. */
  remove(origin: string): void {
    if (!this.get(origin)) return;
    this.sessions.delete(origin);
    try {
      this.storage?.remove(sessionStorageKey(origin));
    } catch {
      // Storage blocked: the session was not persisted either.
    }
    this.apply(this.servers.filter((s) => s.origin !== origin));
  }

  /** The session of one server; the same object every time, so listeners and clients share it. */
  session(origin: string): Session {
    let session = this.sessions.get(origin);
    if (!session) {
      session = new Session(this.storage, sessionStorageKey(origin));
      this.sessions.set(origin, session);
    }
    return session;
  }

  hasSession(origin: string): boolean {
    return this.session(origin).get() !== null;
  }

  /** For `useSyncExternalStore`: called after every change of the list. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** A strictly increasing time, so two uses within one millisecond still have an order. */
  private stamp(): number {
    const newest = this.servers.reduce((max, s) => Math.max(max, s.lastUsedAt), 0);
    return Math.max(this.now(), newest + 1);
  }

  private apply(next: SavedServer[]): void {
    this.servers = next;
    this.rebuild();
    this.save();
    for (const listener of [...this.listeners]) listener();
  }

  private rebuild(): void {
    // Array.prototype.sort is stable, so servers with the same time keep their saved order.
    this.snapshot = [...this.servers].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  }

  private load(): SavedServer[] {
    try {
      const raw = this.storage?.get(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as { v?: unknown; servers?: unknown };
      if (parsed.v !== 1 || !Array.isArray(parsed.servers)) return [];
      return parsed.servers.filter(isSavedServer);
    } catch {
      return [];
    }
  }

  private save(): void {
    // The store drops the write when storage is full or blocked: the list then only lasts for
    // this page load.
    this.storage?.set(STORAGE_KEY, JSON.stringify({ v: 1, servers: this.servers }));
  }
}
