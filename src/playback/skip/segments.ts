// The pure rules behind the skip pills and the scrubber bands, kept apart from React so each can
// be tested on its own.
import type { components } from '../../api/generated/schema';

export type SegmentKind = 'intro' | 'recap' | 'credits' | 'preview';

/** A skippable stretch of the playing file, in source seconds. */
export interface Segment {
  kind: SegmentKind;
  start: number;
  end: number;
}

type Version = components['schemas']['WatchFileVersion'];

/** The marker fields of a file version: the list, and the singular fields older servers send. */
export type MarkerFields = Pick<
  Version,
  'marker_segments' | 'intro' | 'recap' | 'credits' | 'preview'
>;

/** Credits that end this close to the end of the title run to the end of the stream. */
export const CREDITS_TO_END_SECONDS = 2;

const SINGULAR: readonly SegmentKind[] = ['intro', 'recap', 'credits', 'preview'];

const usable = (s: Segment) =>
  Number.isFinite(s.start) && Number.isFinite(s.end) && s.start >= 0 && s.end > s.start;

/**
 * The segments of one file. A server with `marker_segments_v1` lists every occurrence (a kind may
 * occur more than once); an older one sends at most one marker per kind in singular fields.
 */
export function segmentsOf(markers: Partial<MarkerFields>, hasList: boolean): Segment[] {
  const found: Segment[] = hasList
    ? (markers.marker_segments ?? []).map((m) => ({
        kind: m.kind,
        start: m.start_seconds,
        end: m.end_seconds,
      }))
    : SINGULAR.flatMap((kind) => {
        const m = markers[kind];
        return m ? [{ kind, start: m.start_seconds, end: m.end_seconds }] : [];
      });
  // Source-time order; the sort is stable, so equal starts keep the server's order.
  return found.filter(usable).sort((a, b) => a.start - b.start);
}

/** Index of the segment that holds `seconds` (start inclusive, end exclusive), else -1. */
export function activeSegmentIndex(segments: readonly Segment[], seconds: number): number {
  return segments.findIndex((s) => seconds >= s.start && seconds < s.end);
}

/** Skipping this segment ends the stream: it runs to the end of the title. */
export function runsToEnd(segment: Segment, duration: number): boolean {
  return duration > 0 && duration - segment.end <= CREDITS_TO_END_SECONDS;
}

export interface Band {
  start: number;
  end: number;
}

/** The ranges drawn on the scrubber track, as fractions (0-1): intro, recap and credits. */
export function bandFractions(segments: readonly Segment[], duration: number): Band[] {
  if (!(duration > 0)) return [];
  return segments
    .filter((s) => s.kind !== 'preview')
    .map((s) => ({
      start: Math.max(0, Math.min(1, s.start / duration)),
      end: Math.max(0, Math.min(1, s.end / duration)),
    }))
    .filter((b) => b.end > b.start);
}
