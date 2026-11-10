import { useCallback, useEffect, useRef, useState } from 'react';
import { FocusGroup, Focusable, moveFocusTo, type ArrowHandler } from '../../app/nav';
import { Button, ListSkeleton, Screen } from '../../app/ui';
import { useT, type MessageKey } from '../../i18n';
import { SiloApiError } from '../../api/problem';
import { subtitleStyles, type SubtitleFrame } from '../../playback/subtitles/appearance';
import {
  useProfileSettings,
  useResetProfileDeviceSetting,
  useSetProfileDeviceSetting,
  type SubtitleAppearance,
} from './profileSettings';
import {
  BACKGROUND_OPACITIES,
  COLORS,
  FONTS,
  POSITIONS,
  SIZES,
  STYLES,
  TEXT_OPACITIES,
  stepValue,
  stopText,
  type Stop,
} from './subtitleOptions';

type Look = SubtitleAppearance;
type Value = string | number | boolean;

const KEY = 'playback.subtitle_appearance';

/** One change or a burst of them is written this long after the last press. */
export const SAVE_DELAY_MS = 600;

/** A failed write is tried again after these pauses while the page is open; then it stays failed. */
export const RETRY_DELAYS_MS: readonly number[] = [2000, 5000, 15000];

/** No answer at all (network, timeout), a 5xx, a 408 or a 429 may pass on a later try; other 4xx will not. */
function worthRetrying(error: unknown): boolean {
  if (!(error instanceof SiloApiError)) return true;
  const { status } = error;
  return status >= 500 || status === 408 || status === 429;
}

/** The preview is a 16:9 box in the 1080p layout, half the size of the screen. */
const FRAME: SubtitleFrame = { width: 960, height: 540 };

interface RowDef {
  id: string;
  label: MessageKey;
  field: keyof Look;
  values: readonly Value[];
  /** The text of the shown value; a stored value that is none of `values` is shown as it is. */
  text(
    value: Value,
    t: (key: MessageKey, params?: Record<string, string | number>) => string,
  ): string;
  /** The value is a colour: a swatch is drawn next to its name. */
  colour?: boolean;
}

const stopsRow = (
  id: string,
  label: MessageKey,
  field: keyof Look,
  stops: readonly Stop<Value>[],
  colour = false,
): RowDef => ({
  id,
  label,
  field,
  values: stops.map((stop) => stop.value),
  text: (value, t) => stopText(stops, value, t),
  colour,
});

const percentRow = (
  id: string,
  label: MessageKey,
  field: keyof Look,
  values: readonly number[],
): RowDef => ({
  id,
  label,
  field,
  values,
  text: (value, t) => t('settings.subtitles.percent', { percent: String(value) }),
});

const ROWS: readonly RowDef[] = [
  stopsRow('size', 'settings.subtitles.row.size', 'fontSize', SIZES),
  stopsRow('font', 'settings.subtitles.row.font', 'fontFamily', FONTS),
  stopsRow('fontColor', 'settings.subtitles.row.fontColor', 'fontColor', COLORS, true),
  percentRow('textOpacity', 'settings.subtitles.row.textOpacity', 'textOpacity', TEXT_OPACITIES),
  stopsRow('background', 'settings.subtitles.row.background', 'backgroundStyle', STYLES),
  stopsRow(
    'backgroundColor',
    'settings.subtitles.row.backgroundColor',
    'backgroundColor',
    COLORS,
    true,
  ),
  percentRow(
    'backgroundOpacity',
    'settings.subtitles.row.backgroundOpacity',
    'backgroundOpacity',
    BACKGROUND_OPACITIES,
  ),
  {
    id: 'outline',
    label: 'settings.subtitles.row.outline',
    field: 'textOutline',
    values: [false, true],
    text: (value, t) =>
      t(value ? 'settings.subtitles.outline.on' : 'settings.subtitles.outline.off'),
  },
  stopsRow('outlineColor', 'settings.subtitles.row.outlineColor', 'textOutlineColor', COLORS, true),
  stopsRow('position', 'settings.subtitles.row.position', 'position', POSITIONS),
];

const rowKey = (id: string) => `subtitle-row-${id}`;
const RESET_KEY = 'subtitle-reset';

/** The sample lines, drawn by the player's own subtitle styles into a frame of the preview's size. */
function Preview({ look }: { look: Look }) {
  const t = useT();
  const styles = subtitleStyles(look, false, FRAME);
  return (
    <div
      className="subtitle-preview"
      data-testid="subtitle-preview"
      style={{ width: FRAME.width, height: FRAME.height }}
    >
      <div
        className="player-subtitles"
        data-testid="subtitle-preview-block"
        data-position={look.position}
        style={styles.block}
      >
        {(['settings.subtitles.sample1', 'settings.subtitles.sample2'] as const).map((key) => (
          <p key={key} className="player-subtitle-line" style={styles.line}>
            {t(key)}
          </p>
        ))}
      </div>
    </div>
  );
}

/**
 * The look of the subtitles for this profile on this TV: a preview on the left that follows
 * every press at once, the settings as rows on the right. Left and Right change the value of the
 * focused row (OK steps forward) and the complete appearance is written to the server shortly
 * after the last press. A profile_device value replaces the profile's whole object, so the page
 * always writes all ten fields it shows.
 */
export function SubtitleAppearanceScreen({ onBack }: { onBack: () => void }) {
  const t = useT();
  const { values, known } = useProfileSettings();
  const setSetting = useSetProfileDeviceSetting();
  const resetSetting = useResetProfileDeviceSetting();

  // Null follows the effective value; a change makes this page's own copy the one that is shown.
  const [draft, setDraft] = useState<Look | null>(null);
  // 'retrying': the look is unsaved and another try is scheduled; 'final': it is unsaved and stays so.
  const [failed, setFailed] = useState<'retrying' | 'final' | null>(null);
  const look = draft ?? values[KEY];

  const pending = useRef<Look | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Writes and the reset run one after another, so a slow write cannot land after a reset.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const alive = useRef(true);
  // Counts the changes; a reset that finishes after a newer change must not undo it.
  const generation = useRef(0);
  // How many retries the current look has used.
  const attempts = useRef(0);
  // The newest flush: a retry timer and the unmount cleanup call it without being rebuilt.
  const flushLatest = useRef<() => void>(() => undefined);

  const enqueue = useCallback((task: () => Promise<void>) => {
    queue.current = queue.current.then(task);
  }, []);

  const flush = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    pending.current = null;
    if (next === null) return;
    enqueue(async () => {
      try {
        await setSetting(KEY, next);
        attempts.current = 0;
        if (alive.current) setFailed(null);
      } catch (error) {
        // After the page is gone nothing is kept or retried.
        if (!alive.current) return;
        if (pending.current !== null) {
          // A newer look is already waiting for its write and wins over this one.
          setFailed('retrying');
          return;
        }
        // The look stays unsaved: leaving the page sends it once more.
        pending.current = next;
        const delay = RETRY_DELAYS_MS[attempts.current];
        if (worthRetrying(error) && delay !== undefined) {
          attempts.current += 1;
          timer.current = setTimeout(() => flushLatest.current(), delay);
          setFailed('retrying');
        } else {
          setFailed('final');
        }
      }
    });
  }, [enqueue, setSetting]);

  // Leaving the page sends a write that is still waiting for its quiet moment.
  useEffect(() => {
    flushLatest.current = flush;
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      flushLatest.current();
    };
  }, []);

  const change = (next: Look) => {
    generation.current += 1;
    attempts.current = 0;
    setDraft(next);
    pending.current = next;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY_MS);
  };

  const step = (row: RowDef, direction: 1 | -1) => {
    const next = stepValue(row.values, look[row.field], direction);
    change({ ...look, [row.field]: next });
  };

  const reset = () => {
    // A press that has not been written yet would only undo the reset.
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
    attempts.current = 0;
    const started = generation.current;
    enqueue(async () => {
      try {
        await resetSetting(KEY);
        // A change made meanwhile stays shown; its own write follows this one.
        if (!alive.current || generation.current !== started) return;
        setDraft(null);
        setFailed(null);
      } catch {
        if (alive.current) setFailed('final');
      }
    });
  };

  const rows = ROWS.filter((row) => row.id !== 'outlineColor' || look.textOutline);
  const stops = [...rows.map((row) => rowKey(row.id)), RESET_KEY];
  const arrows: ArrowHandler = (direction, fromKey) => {
    const at = stops.indexOf(fromKey);
    if (at < 0) return false;
    if (direction === 'up' || direction === 'down') {
      const target = stops[at + (direction === 'down' ? 1 : -1)];
      // The first and the last row are the ends of the page; the press stops there.
      return target === undefined ? true : moveFocusTo(target);
    }
    const row = rows[at];
    if (row) step(row, direction === 'right' ? 1 : -1);
    return true;
  };

  return (
    <Screen
      title={t('settings.subtitles.title')}
      onBack={onBack}
      testId="subtitle-appearance-screen"
    >
      <div className="subtitle-page">
        <div className="subtitle-preview-column">
          <Preview look={look} />
          {failed ? (
            <p role="alert" className="error" data-testid="subtitle-save-error">
              {t(
                failed === 'retrying'
                  ? 'settings.subtitles.saveRetrying'
                  : 'settings.subtitles.saveFailed',
              )}
            </p>
          ) : null}
        </div>
        {known ? (
          <FocusGroup focusKey="subtitle-rows" className="subtitle-rows" onArrow={arrows}>
            {rows.map((row, index) => {
              const value = look[row.field];
              return (
                <Focusable
                  key={row.id}
                  focusKey={rowKey(row.id)}
                  autoFocus={index === 0}
                  className="btn subtitle-row"
                  data-testid={rowKey(row.id)}
                  onClick={() => step(row, 1)}
                >
                  <span className="subtitle-row-label">{t(row.label)}</span>
                  <span className="subtitle-row-value">
                    <span
                      className="subtitle-chevron"
                      aria-hidden="true"
                      onClick={(event) => {
                        event.stopPropagation();
                        step(row, -1);
                      }}
                    >
                      ‹
                    </span>
                    {row.colour ? (
                      <span
                        className="subtitle-swatch"
                        aria-hidden="true"
                        style={{ backgroundColor: String(value) }}
                      />
                    ) : null}
                    <span className="subtitle-row-text" data-testid={`${rowKey(row.id)}-value`}>
                      {row.text(value, t)}
                    </span>
                    <span
                      className="subtitle-chevron"
                      aria-hidden="true"
                      onClick={(event) => {
                        event.stopPropagation();
                        step(row, 1);
                      }}
                    >
                      ›
                    </span>
                  </span>
                </Focusable>
              );
            })}
            <Button focusKey={RESET_KEY} className="subtitle-reset" onClick={reset}>
              {t('settings.subtitles.reset')}
            </Button>
          </FocusGroup>
        ) : (
          <div className="subtitle-rows">
            <ListSkeleton label={t('settings.subtitles.loading')} rows={ROWS.length} />
          </div>
        )}
      </div>
    </Screen>
  );
}
