import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toApiError } from '../../api/client';
import type { components } from '../../api/generated/schema';
import { SiloApiError } from '../../api/problem';
import { useSilo } from '../../app/SiloContext';
import { getPlatform } from '../../platform';

export type DeviceLoginStart = components['schemas']['DeviceLoginStart'];

export type DeviceLoginState =
  | { phase: 'checking' }
  | { phase: 'unavailable' }
  | { phase: 'error' }
  | { phase: 'waiting'; code: DeviceLoginStart; opened: boolean }
  | { phase: 'denied' }
  | { phase: 'expired' };

type Outcome = 'denied' | 'expired' | 'error';

// Consecutive failed polls (network, 5xx) before the screen gives up and offers a retry.
const MAX_POLL_FAILURES = 5;

/**
 * Device-code sign-in: checks the capability, starts a code, polls it and stores the tokens once
 * a phone approved it. Polling is a timer loop (not a query) because every answer sets the wait
 * before the next poll. Tokens and the device code are never logged.
 */
export function useDeviceLogin(onSignedIn: () => void) {
  const { client, session, device, baseUrl } = useSilo();
  const [code, setCode] = useState<DeviceLoginStart | null>(null);
  const [opened, setOpened] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const requested = useRef(false);
  const signedIn = useRef(onSignedIn);
  useEffect(() => {
    signedIn.current = onSignedIn;
  });

  const capability = useQuery({
    queryKey: ['deviceLogin', baseUrl, 'capability'],
    queryFn: async () => {
      const { data, error, response } = await client.GET('/api/v2/auth/device/capability');
      if (!data) throw toApiError(error, response);
      return data;
    },
    // A fresh answer every time the screen opens; the server may have changed its settings.
    staleTime: 0,
    gcTime: 0,
  });

  const available = capability.data?.state === 'available' && capability.data.allowed !== false;

  const start = useMutation({
    mutationFn: async () => {
      const { data, error, response } = await client.POST('/api/v2/auth/device/start', {
        body: { device_name: device.name, device_platform: getPlatform().siloPlatformId },
      });
      if (!data) throw toApiError(error, response);
      return data;
    },
    onSuccess: (data) => {
      setCode(data);
      setOpened(false);
      setOutcome(null);
    },
    onError: () => setOutcome('error'),
  });
  const startCode = start.mutate;

  // The ref keeps React's development double effect from starting two codes.
  useEffect(() => {
    if (!available || requested.current) return;
    requested.current = true;
    startCode();
  }, [available, startCode]);

  const deviceCode = code?.device_code;
  const interval = code?.interval;
  const expiresAt = code?.expires_at;
  const expiresIn = code?.expires_in;
  useEffect(() => {
    if (!deviceCode) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let wait = Math.max(1, interval ?? 5);
    let deadline = Date.parse(expiresAt ?? '');
    if (Number.isNaN(deadline)) deadline = Date.now() + (expiresIn ?? 900) * 1000;

    const schedule = (seconds: number) => {
      timer = setTimeout(() => void tick(), Math.max(1, seconds) * 1000);
    };

    const tick = async () => {
      if (stopped) return;
      if (Date.now() > deadline) {
        setOutcome('expired');
        return;
      }
      try {
        const { data, error, response } = await client.POST('/api/v2/auth/device/poll', {
          body: { device_code: deviceCode },
        });
        if (stopped) return;
        if (!data) throw toApiError(error, response);
        failures = 0;
        if (data.poll_after > 0) wait = data.poll_after;
        switch (data.status) {
          case 'pending': {
            setOpened(data.opened);
            // Approver lookups can move the expiry; follow the server's deadline.
            const moved = Date.parse(data.expires_at ?? '');
            if (!Number.isNaN(moved)) deadline = moved;
            schedule(wait);
            return;
          }
          case 'approved': {
            const tokens = data.tokens;
            if (!tokens) {
              setOutcome('error');
              return;
            }
            session.set({
              accessToken: tokens.access_token,
              refreshToken: tokens.refresh_token,
              expiresAt: Date.now() + tokens.expires_in * 1000,
              user: tokens.user,
              ...(data.profile_id ? { profileId: data.profile_id } : {}),
              ...(data.profile_token ? { profileToken: data.profile_token } : {}),
            });
            signedIn.current();
            return;
          }
          case 'denied':
            setOutcome('denied');
            return;
          default:
            // expired, consumed, canceled: this code is finished, a new one is needed.
            setOutcome('expired');
            return;
        }
      } catch (e) {
        if (stopped) return;
        if (e instanceof SiloApiError) {
          if (e.status === 429) {
            schedule(Math.max(e.retryAfter ?? 0, wait));
            return;
          }
          if (e.status === 404 || e.status === 410) {
            setOutcome('expired');
            return;
          }
          if (e.status < 500 && e.status !== 408) {
            setOutcome('error');
            return;
          }
        }
        failures += 1;
        if (failures >= MAX_POLL_FAILURES) {
          setOutcome('error');
          return;
        }
        schedule(wait);
      }
    };

    schedule(wait);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [deviceCode, interval, expiresAt, expiresIn, client, session]);

  /** A new code after expiry, denial or an error. */
  const restart = useCallback(() => {
    if (!available) {
      void capability.refetch();
      return;
    }
    setCode(null);
    setOutcome(null);
    requested.current = true;
    startCode();
  }, [available, capability, startCode]);

  /** Withdraws the current code (Back); polling stops because the code is dropped. */
  const cancel = useCallback(() => {
    if (code && !outcome && capability.data?.cancel !== false) {
      client
        .POST('/api/v2/auth/device/cancel', { body: { device_code: code.device_code } })
        .catch(() => undefined);
    }
    setCode(null);
  }, [client, code, outcome, capability.data?.cancel]);

  let state: DeviceLoginState;
  if (capability.isError) state = { phase: 'error' };
  else if (capability.data && !available) state = { phase: 'unavailable' };
  else if (outcome === 'denied') state = { phase: 'denied' };
  else if (outcome === 'expired') state = { phase: 'expired' };
  else if (outcome === 'error') state = { phase: 'error' };
  else if (code) state = { phase: 'waiting', code, opened };
  else state = { phase: 'checking' };

  return { state, restart, cancel };
}
