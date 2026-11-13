import { useCallback } from 'react';
import {
  useProfileSetting,
  useResetProfileDeviceSetting,
  useServerKnowsSetting,
  useSetProfileSettingAt,
} from './profileSettings';

const KEY = 'playback.auto_play_next';

/**
 * The profile's "Auto-play next episode", for the settings screen and the end screen's switch, so
 * both write it the same way: saved at the profile, and this TV's own value dropped, because that
 * would outrank the profile's and the control would snap back (what the web app does). A failed
 * write leaves the shown value as it was.
 */
export function useAutoPlayNext(): {
  /** The server's settings know the key; without it nothing can be saved. */
  known: boolean;
  enabled: boolean;
  set(enabled: boolean): Promise<void>;
} {
  const known = useServerKnowsSetting(KEY);
  const { value } = useProfileSetting(KEY);
  const setProfile = useSetProfileSettingAt('profile');
  const resetDevice = useResetProfileDeviceSetting();
  const set = useCallback(
    async (enabled: boolean) => {
      try {
        await setProfile(KEY, enabled);
        await resetDevice(KEY);
      } catch {
        // The control shows the stored value still.
      }
    },
    [setProfile, resetDevice],
  );
  return { known, enabled: value, set };
}
