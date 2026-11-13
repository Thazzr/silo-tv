import { getPlatform, type KeyValueStore } from '../platform';
import type { components } from './generated/schema';

export type Account = components['schemas']['Account'];

export interface SessionData {
  /** Memory only, never stored. Empty after a relaunch until the first refresh. */
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds at which the access token expires; 0 while there is no access token. */
  expiresAt: number;
  user?: Account;
  profileId?: string;
  profileToken?: string;
}

export type SessionEvent = 'changed' | 'signedOut' | 'profileLocked';

// Bump when the stored shape changes; an unknown version is treated as "signed out". The storage
// key keeps its name; the record inside carries its own version (`v`).
const STORAGE_KEY = 'silo-tv.session.v1';

/** Storage key of the session of one server origin: every server keeps its own sign-in. */
export function sessionStorageKey(origin: string): string {
  return `${STORAGE_KEY}.${origin}`;
}

/**
 * Holds the signed-in session and mirrors it to localStorage.
 *
 * Only the refresh token and the non-secret session facts are written to localStorage (plain
 * text). The access token and its expiry live in memory only: it is short-lived and a relaunch
 * simply refreshes. The refresh token must survive a relaunch, so it stays in storage; encrypting
 * it with keymanager3 on webOS 24+ is a release item before the store submission.
 */
export class Session {
  private data: SessionData | null;
  private readonly listeners: Record<SessionEvent, Set<() => void>> = {
    changed: new Set(),
    signedOut: new Set(),
    profileLocked: new Set(),
  };

  constructor(
    private readonly storage: KeyValueStore | null = getPlatform().storage,
    private readonly storageKey: string = STORAGE_KEY,
  ) {
    this.data = this.load();
  }

  get(): SessionData | null {
    return this.data;
  }

  set(data: SessionData): void {
    this.data = data;
    this.save();
    this.emit('changed');
  }

  /** Merges fields into the current session; does nothing when signed out. */
  update(patch: Partial<SessionData>): void {
    if (!this.data) return;
    this.set({ ...this.data, ...patch });
  }

  /** Ends the session locally and tells listeners the user is signed out. */
  signOut(): void {
    if (!this.data) return;
    this.data = null;
    this.save();
    this.emit('changed');
    this.emit('signedOut');
  }

  /**
   * The server no longer accepts the open profile's PIN proof: forgets the profile and the proof
   * (also from storage) and tells listeners, so the app can ask for the profile again.
   */
  lockProfile(): void {
    if (!this.data) return;
    this.set({ ...this.data, profileId: undefined, profileToken: undefined });
    this.emit('profileLocked');
  }

  on(event: SessionEvent, listener: () => void): () => void {
    this.listeners[event].add(listener);
    return () => {
      this.listeners[event].delete(listener);
    };
  }

  private emit(event: SessionEvent): void {
    for (const listener of [...this.listeners[event]]) listener();
  }

  private load(): SessionData | null {
    try {
      const raw = this.storage?.get(this.storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { v?: unknown; session?: Partial<SessionData> };
      const s = parsed.session;
      // v1 also stored the access token; v2 does not. Both load without one.
      if ((parsed.v !== 1 && parsed.v !== 2) || !s || typeof s.refreshToken !== 'string') {
        return null;
      }
      const loaded: SessionData = {
        accessToken: '',
        refreshToken: s.refreshToken,
        expiresAt: 0,
        user: s.user,
        profileId: s.profileId,
        profileToken: s.profileToken,
      };
      // Rewrite a v1 record at once so its old access token leaves storage.
      if (parsed.v === 1) this.save(loaded);
      return loaded;
    } catch {
      return null;
    }
  }

  private save(data: SessionData | null = this.data): void {
    try {
      if (data) {
        const { refreshToken, user, profileId, profileToken } = data;
        const stored = { refreshToken, user, profileId, profileToken };
        this.storage?.set(this.storageKey, JSON.stringify({ v: 2, session: stored }));
      } else {
        this.storage?.remove(this.storageKey);
      }
    } catch {
      // Storage full or blocked: the session still works for this page load.
    }
  }
}
