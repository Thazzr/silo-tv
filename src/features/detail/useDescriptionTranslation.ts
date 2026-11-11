import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toApiError } from '../../api/client';
import { SiloApiError } from '../../api/problem';
import { useSilo } from '../../app/SiloContext';
import type { Episode, ItemDetail, Season } from './info';
import { itemDetailKey, seasonEpisodesKey } from './queries';
import {
  REREAD_DELAYS_S,
  itemMissing,
  pageTargets,
  seasonMissing,
  translationMode,
  type TranslationMode,
  type TranslationTarget,
} from './translation';

const THIRTY_MINUTES = 30 * 60 * 1000;

/**
 * What this app session has settled per run, kept next to the query cache so it lives as long as
 * the session does and a test (with a cache of its own) starts clean. A run that finished is not
 * started again by itself, and neither is one that failed; a stopped run leaves no trace.
 */
const settledRuns = new WeakMap<QueryClient, Map<string, 'done' | 'failed'>>();
function settledOf(queryClient: QueryClient) {
  let map = settledRuns.get(queryClient);
  if (!map) settledRuns.set(queryClient, (map = new Map()));
  return map;
}

/** A run under way; stopping it ends its waiting without a verdict. */
interface Run {
  season?: number;
  stopped: boolean;
  wake: (() => void) | null;
}

function stopRun(run: Run) {
  run.stopped = true;
  run.wake?.();
}

export interface DescriptionTranslation {
  mode: TranslationMode;
  /** The item's own description is being translated. */
  itemRunning: boolean;
  /** Whether the "Translate description" pill shows. */
  showPill: boolean;
  /** Starts every target that is still missing (the pill's action). */
  start: () => void;
}

/**
 * Translates the descriptions of a detail page when the server offers it. A run asks for the
 * translation and then reads its target again on a schedule until the text is there; nothing
 * about a failure shows on the screen except the pill coming back.
 */
export function useDescriptionTranslation(input: {
  itemId: string;
  detail: ItemDetail;
  series: boolean;
  seriesId: string;
  shownSeason: number | undefined;
  seasons: readonly Season[];
  episodes: readonly Episode[] | undefined;
}): DescriptionTranslation {
  const { client, baseUrl, session } = useSilo();
  const queryClient = useQueryClient();
  const profileId = session.get()?.profileId ?? '';

  const capability = useQuery({
    queryKey: ['capabilities', 'metadata-ai', baseUrl, profileId],
    enabled: profileId !== '',
    staleTime: THIRTY_MINUTES,
    retry: false,
    queryFn: async () => {
      const { data, error, response } = await client.GET('/api/v2/capabilities/metadata-ai', {});
      if (!data) throw toApiError(error, response);
      return data;
    },
  });
  const mode = translationMode(capability.data);

  const { itemId, detail, series, seriesId, shownSeason, seasons, episodes } = input;
  const targets = useMemo(
    () =>
      mode === 'off' ? [] : pageTargets({ itemId, detail, series, shownSeason, seasons, episodes }),
    [mode, itemId, detail, series, shownSeason, seasons, episodes],
  );

  const runs = useRef(new Map<string, Run>());
  const mounted = useRef(true);
  // Bumped when a run ends, so the page reads the settled memo again.
  const [, setTick] = useState(0);
  const [running, setRunning] = useState<ReadonlySet<string>>(new Set());

  const settleKey = useCallback(
    (target: TranslationTarget) => `${baseUrl}|${profileId}|${target.id}|${target.language}`,
    [baseUrl, profileId],
  );
  const forget = useCallback((key: string) => {
    setRunning((old) => {
      if (!old.has(key)) return old;
      const next = new Set(old);
      next.delete(key);
      return next;
    });
  }, []);

  const startRun = useCallback(
    (target: TranslationTarget) => {
      const key = settleKey(target);
      if (runs.current.has(key)) return;
      const run: Run = { season: target.season, stopped: false, wake: null };
      runs.current.set(key, run);
      setRunning((old) => new Set(old).add(key));

      const sleep = (seconds: number) =>
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, seconds * 1000);
          run.wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
      // Reads the target again and says whether it is still missing.
      const stillMissing = async () => {
        if (target.kind === 'item') {
          const queryKey = itemDetailKey(baseUrl, profileId, itemId);
          await queryClient.refetchQueries({ queryKey, exact: true });
          return itemMissing(queryClient.getQueryData<ItemDetail>(queryKey), target.language);
        }
        const queryKey = seasonEpisodesKey(baseUrl, profileId, seriesId, target.season);
        await queryClient.refetchQueries({ queryKey, exact: true });
        return seasonMissing(queryClient.getQueryData<Episode[]>(queryKey), target.language);
      };

      const perform = async (): Promise<'done' | 'failed' | 'stopped'> => {
        try {
          const { data, error, response } = await client.POST(
            '/api/v2/catalog/items/{id}/translate-description',
            {
              params: { path: { id: target.id } },
              body: { target_language: target.language },
            },
          );
          if (run.stopped) return 'stopped';
          if (data) {
            if (data.status === 'failed' || data.status === 'canceled') return 'failed';
          } else {
            const problem = toApiError(error, response);
            // Refused as nothing left to translate, or one request too many: the text may already
            // be there, so read once and see.
            if (!(problem instanceof SiloApiError) || ![422, 429].includes(problem.status)) {
              return 'failed';
            }
            const missing = await stillMissing();
            if (run.stopped) return 'stopped';
            return missing ? 'failed' : 'done';
          }
          for (const delay of REREAD_DELAYS_S) {
            await sleep(delay);
            if (run.stopped) return 'stopped';
            const missing = await stillMissing();
            if (run.stopped) return 'stopped';
            if (!missing) return 'done';
          }
          return 'failed';
        } catch {
          return run.stopped ? 'stopped' : 'failed';
        }
      };

      void perform().then((verdict) => {
        // A stopped run was already taken off the books (a newer run may own its key by now).
        if (run.stopped) return;
        runs.current.delete(key);
        settledOf(queryClient).set(key, verdict === 'done' ? 'done' : 'failed');
        if (!mounted.current) return;
        forget(key);
        setTick((n) => n + 1);
      });
    },
    [baseUrl, client, forget, itemId, profileId, queryClient, seriesId, settleKey],
  );

  // Nothing survives the page: no timer, no request after it.
  useEffect(() => {
    mounted.current = true;
    const active = runs.current;
    return () => {
      mounted.current = false;
      for (const run of active.values()) stopRun(run);
      active.clear();
    };
  }, []);

  // Leaving a season stops its run (stopped, not failed: it may start again when the season shows).
  useEffect(() => {
    for (const [key, run] of runs.current) {
      if (run.season !== undefined && run.season !== shownSeason) {
        stopRun(run);
        runs.current.delete(key);
        forget(key);
      }
    }
  }, [shownSeason, forget]);

  const settled = settledOf(queryClient);

  // Auto mode: every target that is showing and was neither finished nor failed starts by itself.
  useEffect(() => {
    if (mode !== 'auto') return;
    for (const target of targets) {
      const key = settleKey(target);
      if (!settled.has(key)) startRun(target);
    }
  }, [mode, targets, settled, settleKey, startRun]);

  const start = useCallback(() => {
    for (const target of targets) startRun(target);
  }, [targets, startRun]);

  const underway = targets.some((target) => running.has(settleKey(target)));
  const failedSome = targets.some((target) => settled.get(settleKey(target)) === 'failed');
  const showPill =
    targets.length > 0 && !underway && (mode === 'button' || (mode === 'auto' && failedSome));

  return {
    mode,
    itemRunning: targets.some((t) => t.kind === 'item' && running.has(settleKey(t))),
    showPill,
    start,
  };
}
