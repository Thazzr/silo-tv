// The subtitle delay (`player.subtitle_sync_ms`): what a press changes, how it reads, and how it is
// saved. The player shows it at once; the server hears of it once the viewer stops pressing.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SUBTITLE_SYNC_MAX_MS,
  SUBTITLE_SYNC_PROFILE_SCOPE_REVISION,
  useProfileSetting,
  useResetProfileDeviceSetting,
  useSetProfileSettingAt,
  useSettingsRevision,
} from '../../features/settings/profileSettings';

/** One press of Earlier or Later. */
export const SUBTITLE_DELAY_STEP_MS = 100;
/** The last press has to be this long ago before the value is written. */
export const SUBTITLE_DELAY_WRITE_MS = 600;

const KEY = 'player.subtitle_sync_ms';

export const clampDelay = (ms: number): number =>
  Math.max(-SUBTITLE_SYNC_MAX_MS, Math.min(SUBTITLE_SYNC_MAX_MS, Math.round(ms)));

/** "0 ms", "+300 ms", "−100 ms": signed, with a real minus sign (U+2212). */
export function formatDelay(ms: number): string {
  if (ms > 0) return `+${ms} ms`;
  return ms < 0 ? `−${-ms} ms` : '0 ms';
}

/**
 * The delay the player draws with, and the presses that change it (a step either way, or back to
 * 0). The value is the profile's own
 * (a device may keep another). It is written 600 ms after the last press, at the profile scope from
 * manifest revision 19 on (the device's own row is dropped then, as it would outrank the profile's),
 * before that at this device's scope. A pending write goes out when the player closes. A server
 * without a settings contract keeps the change for this viewing only.
 */
export function useSubtitleDelay(): {
  delayMs: number;
  nudge(direction: -1 | 1): void;
  reset(): void;
} {
  const stored = useProfileSetting(KEY).value;
  const revision = useSettingsRevision();
  const setProfile = useSetProfileSettingAt('profile');
  const setDevice = useSetProfileSettingAt('profile_device');
  const resetDevice = useResetProfileDeviceSetting();
  // What the viewer set and the server has not confirmed yet; null = the stored value stands.
  const [pending, setPending] = useState<number | null>(null);
  const delayMs = pending ?? stored;

  const current = useRef(delayMs);
  const dirty = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Resolves whether the server stored the value: with no settings contract it has nowhere to go.
  const writeNow = async (ms: number): Promise<boolean> => {
    if (revision === null) return false;
    if (revision >= SUBTITLE_SYNC_PROFILE_SCOPE_REVISION) {
      await setProfile(KEY, ms);
      await resetDevice(KEY).catch(() => undefined);
    } else await setDevice(KEY, ms);
    return true;
  };
  const write = useRef(writeNow);
  useEffect(() => {
    current.current = delayMs;
    write.current = writeNow;
  });

  const flush = useCallback(() => {
    const ms = dirty.current;
    if (ms === null) return;
    dirty.current = null;
    write.current(ms).then(
      (stored) => {
        // The stored value takes over; a value nobody could store stays what the viewer set.
        if (stored) setPending((now) => (now === ms ? null : now));
      },
      () => undefined,
    );
  }, []);
  useEffect(() => flush, [flush]);

  const change = useCallback(
    (next: number) => {
      if (next === current.current) return;
      current.current = next;
      dirty.current = next;
      setPending(next);
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, SUBTITLE_DELAY_WRITE_MS);
    },
    [flush],
  );
  const nudge = useCallback(
    (direction: -1 | 1) => change(clampDelay(current.current + direction * SUBTITLE_DELAY_STEP_MS)),
    [change],
  );
  const reset = useCallback(() => change(0), [change]);

  return { delayMs, nudge, reset };
}
