import { useCallback, useRef, useState } from 'react';
import { toApiError } from '../../api/client';
import { SiloApiError } from '../../api/problem';
import { useSilo } from '../../app/SiloContext';

export type PasswordLoginFailure =
  | { kind: 'wrong' }
  /** The name is locked for a while (429); `retryAfter` is in seconds when the server said. */
  | { kind: 'locked'; retryAfter: number | undefined }
  | { kind: 'provider' }
  | { kind: 'denied' }
  | { kind: 'server' };

/** Maps a refused sign-in to what the screen says; anything unexpected is "server". */
export function classifyLoginError(error: unknown): PasswordLoginFailure {
  if (!(error instanceof SiloApiError)) return { kind: 'server' };
  if (error.status === 429) return { kind: 'locked', retryAfter: error.retryAfter };
  if (error.status === 401 || error.status === 422) return { kind: 'wrong' };
  if (error.status === 403) return { kind: 'denied' };
  if (error.status === 503 && error.code === 'provider_unavailable') return { kind: 'provider' };
  return { kind: 'server' };
}

/**
 * Password sign-in. This is a plain async call and not a React Query mutation on purpose: a
 * mutation keeps its variables (the password) in the query cache after it finished. The password
 * is only ever an argument here; it is never stored, logged or kept in state by this hook, and a
 * failed attempt is never repeated automatically (every attempt counts toward the lockout).
 */
export function usePasswordLogin(onSignedIn: () => void) {
  const { client, session } = useSilo();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<PasswordLoginFailure | null>(null);
  const busy = useRef(false);

  const login = useCallback(
    async (username: string, password: string, provider?: string): Promise<boolean> => {
      if (busy.current) return false;
      busy.current = true;
      setPending(true);
      setFailure(null);
      try {
        const { data, error, response } = await client.POST('/api/v2/auth/login', {
          body: { username, password, ...(provider ? { provider } : {}) },
        });
        if (!data) throw toApiError(error, response);
        session.set({
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresAt: Date.now() + data.expires_in * 1000,
          user: data.user,
        });
        onSignedIn();
        return true;
      } catch (e) {
        setFailure(classifyLoginError(e));
        return false;
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    [client, session, onSignedIn],
  );

  return { login, pending, failure };
}
