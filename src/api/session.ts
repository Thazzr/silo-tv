import type { components } from './generated/schema';

export type Account = components['schemas']['Account'];

export interface SessionData {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds at which the access token expires. */
  expiresAt: number;
  user?: Account;
  profileId?: string;
  profileToken?: string;
}

export type SessionEvent = 'changed' | 'signedOut';

// Bump when the stored shape changes; an unknown version is treated as "signed out".
const STORAGE_KEY = 'silo-tv.session.v1';

/**
 * Holds the signed-in session and mirrors it to localStorage.
 *
 * TODO(LG checklist: tokens are stored as protected as the platform allows): localStorage is
 * plain text. Move the tokens to protected storage before the first store submission.
 */
export class Session {
  private data: SessionData | null;
  private readonly listeners: Record<SessionEvent, Set<() => void>> = {
    changed: new Set(),
    signedOut: new Set(),
  };

  constructor(private readonly storage: Storage | null = safeStorage()) {
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
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { v?: unknown; session?: Partial<SessionData> };
      const s = parsed.session;
      if (
        parsed.v !== 1 ||
        !s ||
        typeof s.accessToken !== 'string' ||
        typeof s.refreshToken !== 'string' ||
        typeof s.expiresAt !== 'number'
      ) {
        return null;
      }
      return s as SessionData;
    } catch {
      return null;
    }
  }

  private save(): void {
    try {
      if (this.data) {
        this.storage?.setItem(STORAGE_KEY, JSON.stringify({ v: 1, session: this.data }));
      } else {
        this.storage?.removeItem(STORAGE_KEY);
      }
    } catch {
      // Storage full or blocked: the session still works for this page load.
    }
  }
}

function safeStorage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}
