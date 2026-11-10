import { useCallback, useEffect, useRef, useState } from 'react';
import { activeSegmentIndex, runsToEnd, type Segment, type SegmentKind } from './segments';

/** How long a new pill holds the focus, and how long "Watch intro" stays. */
export const PILL_MS = 5000;

export type IntroSkipMode = 'never' | 'ask' | 'always';

/** What the pill offers: skip the segment now playing, or go back to the intro that was skipped. */
export type SkipPill = { mode: 'skip'; kind: SegmentKind } | { mode: 'watch'; kind: 'intro' };

interface Args {
  /** False until the first frame has played and the profile settings are known. */
  enabled: boolean;
  segments: readonly Segment[];
  /** The reported position on the source timeline. */
  position: number;
  duration: number;
  introMode: IntroSkipMode;
  autoSkipRecap: boolean;
  autoSkipCredits: boolean;
  seekTo(sourceSeconds: number): void;
}

export interface SkipPillControl {
  pill: SkipPill | null;
  /** The pill is new (5 s): while the overlay is hidden it holds the focus. */
  focusWindow: boolean;
  /** OK on the pill. */
  activate(): void;
  /** Back: hides the visible pill for its segment. False when there was none. */
  dismiss(): boolean;
}

type Mode = 'never' | 'ask' | 'auto';

/** Offers each segment once and, per the profile's settings, skips it by itself once. */
export function useSkipPill(args: Args): SkipPillControl {
  const { enabled, segments, position } = args;
  const latest = useRef(args);
  useEffect(() => {
    latest.current = args;
  });

  const modeOf = (kind: SegmentKind): Mode => {
    if (kind === 'intro') {
      return args.introMode === 'always' ? 'auto' : args.introMode === 'ask' ? 'ask' : 'never';
    }
    if (kind === 'recap') return args.autoSkipRecap ? 'auto' : 'ask';
    if (kind === 'credits') return args.autoSkipCredits ? 'auto' : 'ask';
    return 'ask';
  };

  const index = enabled ? activeSegmentIndex(segments, position) : -1;
  const segment = index >= 0 ? segments[index] : undefined;
  const mode = segment ? modeOf(segment.kind) : 'never';

  // Segments that were skipped by themselves; a seek back into one does not skip again.
  const autoDone = useRef(new Set<number>());
  const [dismissed, setDismissed] = useState<ReadonlySet<number>>(new Set());
  const [watch, setWatch] = useState<number | null>(null);

  /** Where a skip of this segment lands: the very end for credits that run to it. */
  const target = useCallback(
    (s: Segment) => (runsToEnd(s, latest.current.duration) ? latest.current.duration : s.end),
    [],
  );

  useEffect(() => {
    if (index < 0 || mode !== 'auto' || autoDone.current.has(index)) return;
    const s = latest.current.segments[index]!;
    autoDone.current.add(index);
    latest.current.seekTo(target(s));
    if (s.kind === 'intro') setWatch(index);
  }, [index, mode, target]);

  // "Watch intro" goes after its 5 s.
  useEffect(() => {
    if (watch === null) return;
    const timer = setTimeout(() => setWatch(null), PILL_MS);
    return () => clearTimeout(timer);
  }, [watch]);

  let pill: SkipPill | null = null;
  let key: string | null = null;
  if (watch !== null) {
    pill = { mode: 'watch', kind: 'intro' };
    key = `watch:${watch}`;
  } else if (segment && mode === 'ask' && !dismissed.has(index)) {
    pill = { mode: 'skip', kind: segment.kind };
    key = `skip:${index}`;
  }

  // The focus window opens when a pill appears and closes after PILL_MS (derived while rendering,
  // so the pill never shows one frame without its focus).
  const [lastKey, setLastKey] = useState<string | null>(null);
  const [windowOpen, setWindowOpen] = useState(false);
  if (key !== lastKey) {
    setLastKey(key);
    setWindowOpen(key !== null);
  }
  useEffect(() => {
    if (!windowOpen) return;
    const timer = setTimeout(() => setWindowOpen(false), PILL_MS);
    return () => clearTimeout(timer);
  }, [windowOpen, key]);

  const activate = useCallback(() => {
    const { segments: list, seekTo } = latest.current;
    if (watch !== null) {
      setWatch(null);
      const intro = list[watch];
      if (intro) seekTo(intro.start);
      return;
    }
    const s = index >= 0 ? list[index] : undefined;
    if (!s || !pill) return;
    setDismissed((was) => new Set(was).add(index));
    seekTo(target(s));
  }, [watch, index, pill, target]);

  const dismiss = useCallback((): boolean => {
    if (!pill) return false;
    if (watch !== null) setWatch(null);
    else setDismissed((was) => new Set(was).add(index));
    return true;
  }, [pill, watch, index]);

  return { pill, focusWindow: pill !== null && windowOpen, activate, dismiss };
}
