// The subtitle appearance as Silo's web app keeps it: one object for the profile on all devices
// (`playback.subtitle_appearance` at the `profile` scope). Every change writes the whole object at
// once, the effective value in the shared cache follows before the server has answered, and the
// writes run one after another so quick presses can neither reorder nor lose each other.
import { useCallback } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toApiError } from '../../api/client';
import { useSilo } from '../../app/SiloContext';
import {
  DEFAULT_SUBTITLE_APPEARANCE,
  defaultSettings,
  useProfileSettings,
  type SettingValues,
  type SubtitleAppearance,
} from './profileSettings';

const KEY = 'playback.subtitle_appearance';

/** The writes of one app session: they queue behind each other, whichever dialog started them. */
interface Lane {
  /** The last write that was started. */
  tail: Promise<void>;
  /** Writes that were started and have not finished yet. */
  waiting: number;
  /** The newest value the server is known to hold; what the cache returns to after a failed write. */
  confirmed: SubtitleAppearance;
}

const lanes = new WeakMap<QueryClient, Lane>();

function laneOf(queryClient: QueryClient): Lane {
  let lane = lanes.get(queryClient);
  if (!lane) {
    lane = { tail: Promise.resolve(), waiting: 0, confirmed: DEFAULT_SUBTITLE_APPEARANCE };
    lanes.set(queryClient, lane);
  }
  return lane;
}

/**
 * The profile's subtitle appearance and the two ways to change it. `change` writes the whole
 * object with the patch laid over the newest value; `reset` deletes the stored value (at the
 * profile and at this TV, which would outrank the profile's), so the server's default applies.
 * Neither tells the viewer about a failure: a failed write leaves the last stored value in the
 * cache, and the next change tries again.
 */
export function useSubtitleAppearance(): {
  appearance: SubtitleAppearance;
  change(patch: Partial<SubtitleAppearance>): void;
  reset(): void;
} {
  const { client, baseUrl, session } = useSilo();
  const queryClient = useQueryClient();
  const { values } = useProfileSettings();

  const profileKey = useCallback(
    () => ['settings', 'effective', baseUrl, session.get()?.profileId ?? ''],
    [baseUrl, session],
  );
  const show = useCallback(
    (value: SubtitleAppearance) =>
      queryClient.setQueriesData<SettingValues>({ queryKey: profileKey() }, (old) =>
        // A read that has not answered (or failed) leaves the defaults; the change still shows.
        ({ ...(old ?? defaultSettings()), [KEY]: value }),
      ),
    [queryClient, profileKey],
  );
  const newest = useCallback(
    () =>
      queryClient
        .getQueriesData<SettingValues>({ queryKey: profileKey() })
        .map(([, data]) => data?.[KEY])
        .find((value) => value !== undefined) ?? DEFAULT_SUBTITLE_APPEARANCE,
    [queryClient, profileKey],
  );

  /** Runs `write` after every earlier one; a rejection is a failed write. */
  const enqueue = useCallback(
    (write: () => Promise<void>) => {
      const lane = laneOf(queryClient);
      lane.waiting += 1;
      lane.tail = lane.tail.then(async () => {
        const failed = await write().then(
          () => false,
          () => true,
        );
        lane.waiting -= 1;
        // Only when nothing newer is on its way: that one carries the whole object anyway.
        if (failed && lane.waiting === 0) show(lane.confirmed);
      });
    },
    [queryClient, show],
  );

  const remove = useCallback(
    async (scope: 'profile' | 'profile_device'): Promise<void> => {
      const { error, response } = await client.DELETE('/api/v2/settings/values/{key}', {
        params: { path: { key: KEY }, query: { scope } },
      });
      // No row at that scope is as good as a deleted one.
      if (!response.ok && response.status !== 404) throw toApiError(error, response);
    },
    [client],
  );

  const change = useCallback(
    (patch: Partial<SubtitleAppearance>) => {
      const lane = laneOf(queryClient);
      const before = newest();
      // With no write on its way the cache is what the server holds.
      if (lane.waiting === 0) lane.confirmed = before;
      const next = { ...before, ...patch };
      show(next);
      enqueue(async () => {
        const { data, error, response } = await client.PUT('/api/v2/settings/values/{key}', {
          params: { path: { key: KEY }, query: { scope: 'profile' } },
          body: { value: next },
        });
        if (!data) throw toApiError(error, response);
        lane.confirmed = next;
        // A value at this TV's scope would outrank the one just written. The choice is stored
        // already (`confirmed`), so a delete that fails only ends the write: the cache returns to
        // the value just stored, which is the one it shows.
        await remove('profile_device');
      });
    },
    [queryClient, newest, show, enqueue, client, remove],
  );

  const reset = useCallback(() => {
    const lane = laneOf(queryClient);
    if (lane.waiting === 0) lane.confirmed = newest();
    show(DEFAULT_SUBTITLE_APPEARANCE);
    enqueue(async () => {
      await remove('profile');
      await remove('profile_device');
      lane.confirmed = DEFAULT_SUBTITLE_APPEARANCE;
      // What the server resolves now (its own default) replaces the one shown meanwhile, unless
      // a newer change is queued behind this one and would be overwritten by the read.
      if (lane.waiting === 1) {
        await queryClient.invalidateQueries({ queryKey: profileKey() });
      }
    });
  }, [queryClient, newest, show, enqueue, remove, profileKey]);

  return { appearance: values[KEY], change, reset };
}
