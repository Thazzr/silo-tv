import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toApiError } from '../../api/client';
import { getPlatform } from '../../platform';
import { useSilo } from '../../app/SiloContext';

/**
 * The settings the app reads from the active profile's effective values (settings contract v1).
 * `introducedIn` is the manifest revision that added the key: a server whose
 * `manifest_revision` is lower does not know it, and asking for an unknown key fails the whole
 * read, so such a key is never sent and its default applies. Writing comes with the settings UI.
 */
export const PROFILE_SETTINGS = {
  'ui.title_art': { introducedIn: 16, default: true },
  'catalog.hide_unwatched_episode_images': { introducedIn: 17, default: false },
  'catalog.hide_unwatched_episode_overviews': { introducedIn: 17, default: false },
  'ui.theme_music_enabled': { introducedIn: 11, default: false },
  'ui.theme_music_loop': { introducedIn: 11, default: false },
} as const satisfies Record<string, { introducedIn: number; default: boolean }>;

export type ProfileSettingKey = keyof typeof PROFILE_SETTINGS;
export type SettingValues = Record<ProfileSettingKey, boolean>;

const KEYS = Object.keys(PROFILE_SETTINGS) as ProfileSettingKey[];

export function defaultSettings(): SettingValues {
  const values = {} as SettingValues;
  for (const key of KEYS) values[key] = PROFILE_SETTINGS[key].default;
  return values;
}

/** The registry keys a server with this manifest revision knows. */
export function keysKnownAt(manifestRevision: number): ProfileSettingKey[] {
  return KEYS.filter((key) => PROFILE_SETTINGS[key].introducedIn <= manifestRevision);
}

/** The defaults, overlaid with every answered item of the expected type; anything else is ignored. */
export function settingValuesFrom(items: readonly { key: string; value?: unknown }[]) {
  const values = defaultSettings();
  for (const item of items) {
    const key = item.key as ProfileSettingKey;
    if (key in PROFILE_SETTINGS && typeof item.value === 'boolean') values[key] = item.value;
  }
  return values;
}

const DEFAULTS = defaultSettings();

const THIRTY_MINUTES = 30 * 60 * 1000;
const ONE_MINUTE = 60 * 1000;

/** What the app is told about the server's settings contract, as a manifest revision or null. */
function useManifestRevision(profileId: string) {
  const { client, baseUrl } = useSilo();
  return useQuery({
    queryKey: ['settings', 'capabilities', baseUrl, profileId],
    enabled: profileId !== '',
    staleTime: THIRTY_MINUTES,
    retry: false,
    queryFn: async () => {
      const { data, error, response } = await client.GET('/api/v2/settings/contract/capabilities', {
        params: { header: { 'X-Profile-Id': profileId } },
      });
      if (!data) throw toApiError(error, response);
      // Not offered (or not for this account): everything stays at its default.
      return data.state === 'available' && data.allowed !== false ? data.manifest_revision : null;
    },
  });
}

/**
 * The effective values of the registry keys for the active profile, and whether the server's
 * answer is settled (`known`). Every consumer shares one capability read and one value read. A
 * server without the contract, an unusable answer or a failed read leaves the defaults, so the
 * screens never wait on a failing server.
 */
export function useProfileSettings(): { values: SettingValues; known: boolean } {
  const { client, baseUrl, session } = useSilo();
  const profileId = session.get()?.profileId ?? '';
  const capabilities = useManifestRevision(profileId);
  const revision = capabilities.data ?? null;
  const keys = useMemo(() => (revision === null ? [] : keysKnownAt(revision)), [revision]);

  const effective = useQuery({
    queryKey: ['settings', 'effective', baseUrl, profileId, keys.join(',')],
    enabled: profileId !== '' && keys.length > 0,
    staleTime: ONE_MINUTE,
    retry: false,
    queryFn: async () => {
      const { data, error, response } = await client.GET('/api/v2/settings/values/effective', {
        params: { header: { 'X-Profile-Id': profileId }, query: { keys } },
      });
      if (!data) throw toApiError(error, response);
      return settingValuesFrom(data.items);
    },
  });

  const values = effective.data ?? DEFAULTS;
  // Without a profile there is nothing to ask. Otherwise the capabilities settle first; the
  // values are awaited only when the server has something to say about them.
  const known =
    profileId === '' || (!capabilities.isPending && (keys.length === 0 || !effective.isPending));
  return { values, known };
}

/** One setting of the active profile; `known` is false until the server has answered (or failed). */
export function useProfileSetting(key: ProfileSettingKey): { value: boolean; known: boolean } {
  const { values, known } = useProfileSettings();
  return { value: values[key], known };
}

/**
 * Reads the values again when the app comes back to the foreground (a relaunch, or the page
 * becoming visible), since they may have been changed on another device meanwhile. Rendered once
 * per signed-in server.
 */
export function ProfileSettingsSync() {
  const queryClient = useQueryClient();
  const { baseUrl } = useSilo();
  useEffect(() => {
    const reread = () =>
      void queryClient.invalidateQueries({ queryKey: ['settings', 'effective', baseUrl] });
    const offRelaunch = getPlatform().onRelaunch(reread);
    const onVisible = () => {
      if (document.visibilityState === 'visible') reread();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      offRelaunch();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [queryClient, baseUrl]);
  return null;
}
