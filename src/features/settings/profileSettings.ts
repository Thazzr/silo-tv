import { useCallback, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toApiError } from '../../api/client';
import { getPlatform } from '../../platform';
import { useSilo } from '../../app/SiloContext';

/** One registry entry: its type lives in `parse`, which returns undefined for an unusable value. */
interface SettingDef<T> {
  /** The manifest revision that added the key; a server below it does not know the key. */
  introducedIn: number;
  default: T;
  parse: (raw: unknown) => T | undefined;
}

const bool = (introducedIn: number, def: boolean): SettingDef<boolean> => ({
  introducedIn,
  default: def,
  parse: (raw) => (typeof raw === 'boolean' ? raw : undefined),
});

const integer = (
  introducedIn: number,
  def: number,
  min: number,
  max: number,
): SettingDef<number> => ({
  introducedIn,
  default: def,
  parse: (raw) =>
    typeof raw === 'number' && Number.isInteger(raw) && raw >= min && raw <= max ? raw : undefined,
});

/** An optional integer: null (the default) when unset, and for anything that is not one in range. */
const optionalInteger = (
  introducedIn: number,
  min: number,
  max: number,
): SettingDef<number | null> => ({
  introducedIn,
  default: null,
  parse: (raw) =>
    typeof raw === 'number' && Number.isInteger(raw) && raw >= min && raw <= max ? raw : null,
});

/** A closed set of strings or numbers, as the contract's `enum` value schema. */
const oneOf = <V extends string | number>(
  introducedIn: number,
  values: readonly V[],
  def: V,
): SettingDef<V> => ({
  introducedIn,
  default: def,
  parse: (raw) => values.find((value) => value === raw),
});

export interface SubtitleAppearance {
  fontSize: 'small' | 'medium' | 'large' | 'xlarge' | 'xxlarge';
  fontFamily: string;
  fontColor: string;
  backgroundColor: string;
  backgroundStyle: 'box' | 'shadow' | 'outline' | 'none';
  backgroundOpacity: number;
  textOpacity: number;
  textOutline: boolean;
  textOutlineColor: string;
  position: 'bottom' | 'lower-third' | 'top';
}

export const DEFAULT_SUBTITLE_APPEARANCE: SubtitleAppearance = {
  fontSize: 'large',
  fontFamily: 'sans-serif',
  fontColor: '#ffffff',
  backgroundColor: '#000000',
  backgroundStyle: 'box',
  backgroundOpacity: 75,
  textOpacity: 100,
  textOutline: false,
  textOutlineColor: '#000000',
  position: 'bottom',
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
// The contract's family pattern: no control characters, quotes, separators, brackets or a leading
// space, so the name stays safe to put into CSS.
// eslint-disable-next-line no-control-regex
const FONT_FAMILY = /^[^\x00-\x1f"'(){};:,\\/ ][^\x00-\x1f"'(){};:,\\/]*$/;

type FieldCheck = (raw: unknown) => boolean;
const oneOfFields =
  (values: readonly string[]): FieldCheck =>
  (raw) =>
    typeof raw === 'string' && values.includes(raw);
const intIn =
  (min: number, max: number): FieldCheck =>
  (raw) =>
    typeof raw === 'number' && Number.isInteger(raw) && raw >= min && raw <= max;
const colour: FieldCheck = (raw) => typeof raw === 'string' && HEX_COLOR.test(raw);

const APPEARANCE_FIELDS: Record<keyof SubtitleAppearance, FieldCheck> = {
  fontSize: oneOfFields(['small', 'medium', 'large', 'xlarge', 'xxlarge']),
  fontFamily: (raw) => typeof raw === 'string' && raw.length <= 64 && FONT_FAMILY.test(raw),
  fontColor: colour,
  backgroundColor: colour,
  backgroundStyle: oneOfFields(['box', 'shadow', 'outline', 'none']),
  backgroundOpacity: intIn(0, 100),
  textOpacity: intIn(1, 100),
  textOutline: (raw) => typeof raw === 'boolean',
  textOutlineColor: colour,
  position: oneOfFields(['bottom', 'lower-third', 'top']),
};

/**
 * A stored appearance is a sparse override: every valid field is laid over the default, and an
 * invalid or unknown one falls back to the default field instead of dropping the whole object.
 */
const appearance = (introducedIn: number): SettingDef<SubtitleAppearance> => ({
  introducedIn,
  default: DEFAULT_SUBTITLE_APPEARANCE,
  parse: (raw) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
    const stored = raw as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...DEFAULT_SUBTITLE_APPEARANCE };
    for (const field of Object.keys(APPEARANCE_FIELDS) as (keyof SubtitleAppearance)[]) {
      if (APPEARANCE_FIELDS[field](stored[field])) merged[field] = stored[field];
    }
    return merged as unknown as SubtitleAppearance;
  },
});

/** The contract's bounds for the subtitle offset. */
export const SUBTITLE_SYNC_MAX_MS = 10_000;
/** The manifest revision that added the `profile` scope for `player.subtitle_sync_ms`. */
export const SUBTITLE_SYNC_PROFILE_SCOPE_REVISION = 19;

const SKIP_SECONDS = [5, 10, 15, 30, 45, 60, 90] as const;
const QUALITIES = ['auto', '480p', '720p', '1080p', '2160p', 'original'] as const;

/**
 * The settings the app reads from the active profile's effective values (settings contract v1),
 * each with its type, default and the manifest revision that introduced it. A server whose
 * `manifest_revision` is lower does not know a key, and asking for an unknown key fails the whole
 * read, so such a key is never sent and its default applies. A value of the wrong type or outside
 * its range is treated as absent, so a bad answer can never break a screen.
 */
export const PROFILE_SETTINGS = {
  'ui.title_art': bool(16, true),
  'ui.time_format': oneOf(1, ['auto', '12h', '24h'] as const, 'auto'),
  'catalog.hide_unwatched_episode_images': bool(17, false),
  'catalog.hide_unwatched_episode_overviews': bool(17, false),
  'ui.theme_music_enabled': bool(11, false),
  'ui.theme_music_loop': bool(11, false),
  'playback.intro_skip_mode': oneOf(7, ['never', 'ask', 'always'] as const, 'ask'),
  'playback.auto_skip_recap': bool(1, false),
  'playback.auto_skip_credits': bool(1, false),
  'playback.auto_play_next': bool(1, true),
  'playback.next_up_prompt_seconds': integer(1, 30, 0, 120),
  'playback.auto_play_next_preview': bool(1, false),
  'playback.preferred_quality': oneOf(1, QUALITIES, 'auto'),
  'playback.subtitle_appearance': appearance(1),
  // Kbit/s; null = uncapped. Sent as `bandwidth_cap_kbps` on every start and replan.
  'playback.max_bitrate_kbps': optionalInteger(1, 100, 200000),
  // What to do on Auto when playback keeps buffering; the server knows the key from revision 23.
  'playback.buffering_quality_mode': oneOf(23, ['never', 'ask', 'always'] as const, 'always'),
  // Enums in the contract (not free integers), stored for the profile only.
  'player.video_skip_back_seconds': oneOf(9, SKIP_SECONDS, 10),
  'player.video_skip_forward_seconds': oneOf(9, SKIP_SECONDS, 30),
  // Subtitle delay in ms (positive = later). Written at `profile` from revision 19, before that at
  // `profile_device`.
  'player.subtitle_sync_ms': integer(1, 0, -SUBTITLE_SYNC_MAX_MS, SUBTITLE_SYNC_MAX_MS),
} as const satisfies Record<string, SettingDef<unknown>>;

export type ProfileSettingKey = keyof typeof PROFILE_SETTINGS;
export type SettingValues = {
  [K in ProfileSettingKey]: (typeof PROFILE_SETTINGS)[K]['default'];
};

/**
 * `playback.intro_skip_mode` only exists from revision 7. Below that the deprecated boolean
 * stands in for it (true = always, false = ask); from 7 on the server mirrors both, so only the
 * enum is asked for.
 */
const LEGACY_INTRO_KEY = 'playback.auto_skip_intro';
const LEGACY_INTRO_RETIRED_AT = 7;

const KEYS = Object.keys(PROFILE_SETTINGS) as ProfileSettingKey[];
const DEFS = PROFILE_SETTINGS as Record<string, SettingDef<unknown>>;

export function defaultSettings(): SettingValues {
  const values: Record<string, unknown> = {};
  for (const key of KEYS) values[key] = PROFILE_SETTINGS[key].default;
  return values as SettingValues;
}

/**
 * The keys to ask a server with this manifest revision for: the registry keys it knows, plus the
 * legacy intro-skip boolean while the server is below revision 7.
 */
export function keysKnownAt(manifestRevision: number): string[] {
  const keys: string[] = KEYS.filter(
    (key) => PROFILE_SETTINGS[key].introducedIn <= manifestRevision,
  );
  if (manifestRevision < LEGACY_INTRO_RETIRED_AT) keys.push(LEGACY_INTRO_KEY);
  return keys;
}

/** The defaults, overlaid with every answered item of the expected type; anything else is ignored. */
export function settingValuesFrom(items: readonly { key: string; value?: unknown }[]) {
  const values = defaultSettings() as Record<string, unknown>;
  const answered = new Set<string>();
  for (const item of items) {
    const def = Object.prototype.hasOwnProperty.call(DEFS, item.key) ? DEFS[item.key] : undefined;
    const parsed = def?.parse(item.value);
    if (parsed === undefined) continue;
    values[item.key] = parsed;
    answered.add(item.key);
  }
  if (!answered.has('playback.intro_skip_mode')) {
    const legacy = items.find((item) => item.key === LEGACY_INTRO_KEY)?.value;
    if (typeof legacy === 'boolean') values['playback.intro_skip_mode'] = legacy ? 'always' : 'ask';
  }
  return values as SettingValues;
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

/** The server's settings manifest revision; null until it answered or when there is no contract. */
export function useSettingsRevision(): number | null {
  const { session } = useSilo();
  const profileId = session.get()?.profileId ?? '';
  return useManifestRevision(profileId).data ?? null;
}

/** Whether the server's settings contract knows this key; false until it answered, or when it has no contract. */
export function useServerKnowsSetting(key: ProfileSettingKey): boolean {
  const { session } = useSilo();
  const profileId = session.get()?.profileId ?? '';
  const revision = useManifestRevision(profileId).data ?? null;
  return revision !== null && keysKnownAt(revision).includes(key);
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
export function useProfileSetting<K extends ProfileSettingKey>(
  key: K,
): { value: SettingValues[K]; known: boolean } {
  const { values, known } = useProfileSettings();
  return { value: values[key], known };
}

/** The keys the contract lets a device override (`profile_device` among their allowed scopes). */
export type DeviceSettingKey =
  | 'playback.intro_skip_mode'
  | 'playback.auto_skip_recap'
  | 'playback.auto_skip_credits'
  | 'playback.auto_play_next'
  | 'playback.next_up_prompt_seconds'
  | 'playback.auto_play_next_preview'
  | 'playback.preferred_quality'
  | 'playback.subtitle_appearance'
  | 'playback.max_bitrate_kbps'
  | 'playback.buffering_quality_mode'
  | 'player.subtitle_sync_ms';

/**
 * Writes one setting of the active profile at `scope` and puts the stored value into the shared
 * effective-values cache, so every consumer follows at once. Rejects when the write fails; the
 * caller decides whether that is worth telling the viewer.
 */
export function useSetProfileSettingAt(scope: 'profile' | 'profile_device') {
  const { client, baseUrl, session } = useSilo();
  const queryClient = useQueryClient();
  return useCallback(
    async <K extends DeviceSettingKey>(key: K, value: SettingValues[K]): Promise<void> => {
      const profileId = session.get()?.profileId ?? '';
      if (profileId === '') throw new Error('No profile is open');
      const { data, error, response } = await client.PUT('/api/v2/settings/values/{key}', {
        params: {
          header: { 'X-Profile-Id': profileId },
          path: { key },
          query: { scope },
        },
        body: { value },
      });
      if (!data) throw toApiError(error, response);
      // The server normalizes what it stores; follow its answer, falling back to what was sent.
      const stored = DEFS[key]!.parse(data.value) ?? value;
      queryClient.setQueriesData<SettingValues>(
        { queryKey: ['settings', 'effective', baseUrl, profileId] },
        (old) => (old ? { ...old, [key]: stored } : old),
      );
    },
    [client, baseUrl, session, queryClient, scope],
  );
}

/** Writes one setting at the `profile_device` scope (this TV only). */
export function useSetProfileDeviceSetting() {
  return useSetProfileSettingAt('profile_device');
}

/**
 * Removes this TV's own value of one setting, so the profile's value (or the default) applies
 * again, and reads the effective values anew. A 404 (there was no device value) counts as done.
 * Rejects when the delete fails.
 */
export function useResetProfileDeviceSetting() {
  const { client, baseUrl, session } = useSilo();
  const queryClient = useQueryClient();
  return useCallback(
    async (key: DeviceSettingKey): Promise<void> => {
      const profileId = session.get()?.profileId ?? '';
      if (profileId === '') throw new Error('No profile is open');
      const { error, response } = await client.DELETE('/api/v2/settings/values/{key}', {
        params: {
          header: { 'X-Profile-Id': profileId },
          path: { key },
          query: { scope: 'profile_device' },
        },
      });
      if (!response.ok && response.status !== 404) throw toApiError(error, response);
      // Resolves once the active reads have answered, so the caller can show the effective value.
      await queryClient.invalidateQueries({
        queryKey: ['settings', 'effective', baseUrl, profileId],
      });
    },
    [client, baseUrl, session, queryClient],
  );
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
