import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import {
  Focusable,
  FocusGroup,
  SelfFocusing,
  doesFocusableExist,
  focusFromPointer,
  getCurrentFocusKey,
  moveFocusTo,
  setFocus,
  useBackHandler,
  type ArrowHandler,
} from '../../app/nav';
import { useT, type MessageKey } from '../../i18n';
import { subtitleStyles, type SubtitleFrame } from '../../playback/subtitles/appearance';
import type { SubtitleAppearance } from './profileSettings';
import { useSubtitleAppearance } from './subtitleAppearance';
import {
  BACKGROUND_COLORS,
  BACKGROUND_OPACITY_RANGE,
  FONTS,
  FONT_COLORS,
  POSITIONS,
  SIZES,
  STYLES,
  TEXT_OPACITY_RANGE,
  stepOpacity,
  stepValue,
  type Stop,
} from './subtitleOptions';

type Look = SubtitleAppearance;

/**
 * The sample is drawn into a box of this size, with the cues at the size they have over the video
 * (scale 1, the 1080p layout) and the offsets measured in the box. It is tall enough for the two
 * sample lines at "Extrem groß", each of which may wrap, plus the offset of every position.
 */
const FRAME: SubtitleFrame = { width: 920, height: 410, scale: 1 };

type Section = 'text' | 'background' | 'position';

type Control =
  /** One of a few named values, shown as chips. */
  | { kind: 'chips'; stops: readonly Stop<string>[] }
  /** One of a few colours, shown as round swatches. */
  | { kind: 'swatches'; stops: readonly Stop<string>[] }
  /** A percentage that Left and Right change in steps. */
  | { kind: 'stepper'; range: { min: number; max: number }; name: MessageKey }
  /** On or off. */
  | { kind: 'switch'; name: MessageKey };

interface RowDef {
  id: string;
  section: Section;
  label: MessageKey;
  field: keyof Look;
  control: Control;
  /** Only while the background style is Box. */
  boxOnly?: boolean;
}

// The rows and their order are the web dialog's. The outline colour has no row there either.
const ROWS: readonly RowDef[] = [
  {
    id: 'size',
    section: 'text',
    label: 'settings.subtitles.row.size',
    field: 'fontSize',
    control: { kind: 'chips', stops: SIZES },
  },
  {
    id: 'font',
    section: 'text',
    label: 'settings.subtitles.row.font',
    field: 'fontFamily',
    control: { kind: 'chips', stops: FONTS },
  },
  {
    id: 'fontColor',
    section: 'text',
    label: 'settings.subtitles.row.color',
    field: 'fontColor',
    control: { kind: 'swatches', stops: FONT_COLORS },
  },
  {
    id: 'textOpacity',
    section: 'text',
    label: 'settings.subtitles.row.opacity',
    field: 'textOpacity',
    control: { kind: 'stepper', range: TEXT_OPACITY_RANGE, name: 'settings.subtitles.textOpacity' },
  },
  {
    id: 'outline',
    section: 'text',
    label: 'settings.subtitles.row.outline',
    field: 'textOutline',
    control: { kind: 'switch', name: 'settings.subtitles.textOutline' },
  },
  {
    id: 'style',
    section: 'background',
    label: 'settings.subtitles.row.style',
    field: 'backgroundStyle',
    control: { kind: 'chips', stops: STYLES },
  },
  {
    id: 'backgroundOpacity',
    section: 'background',
    label: 'settings.subtitles.row.opacity',
    field: 'backgroundOpacity',
    control: {
      kind: 'stepper',
      range: BACKGROUND_OPACITY_RANGE,
      name: 'settings.subtitles.backgroundOpacity',
    },
    boxOnly: true,
  },
  {
    id: 'backgroundColor',
    section: 'background',
    label: 'settings.subtitles.row.color',
    field: 'backgroundColor',
    control: { kind: 'swatches', stops: BACKGROUND_COLORS },
    boxOnly: true,
  },
  {
    id: 'position',
    section: 'position',
    label: 'settings.subtitles.row.vertical',
    field: 'position',
    control: { kind: 'chips', stops: POSITIONS },
  },
];

const SECTION_TITLE: Record<Section, MessageKey> = {
  text: 'settings.subtitles.section.text',
  background: 'settings.subtitles.section.background',
  position: 'settings.subtitles.section.position',
};

const rowKey = (id: string) => `subtitle-dialog-${id}`;
const RESET_KEY = 'subtitle-dialog-reset';

/** The sample lines, drawn by the player's own subtitle styles into a frame of the preview's size. */
function Preview({ look }: { look: Look }) {
  const t = useT();
  const styles = subtitleStyles(look, 0, FRAME);
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

/** The value of one row: chips, swatches, a stepper or a switch; the row itself is the focus stop. */
function RowControl({
  row,
  look,
  onPick,
  onStep,
}: {
  row: RowDef;
  look: Look;
  onPick(value: string): void;
  onStep(direction: 1 | -1): void;
}) {
  const t = useT();
  const { control } = row;
  const value = look[row.field];

  if (control.kind === 'chips') {
    return (
      <>
        {control.stops.map((stop) => (
          <span
            key={stop.value}
            role="radio"
            aria-checked={value === stop.value}
            className="subtitle-chip"
            onClick={() => onPick(stop.value)}
          >
            {t(stop.text)}
          </span>
        ))}
      </>
    );
  }
  if (control.kind === 'swatches') {
    return (
      <>
        {control.stops.map((stop) => (
          <span
            key={stop.value}
            role="radio"
            aria-checked={value === stop.value}
            aria-label={t(stop.text)}
            className="subtitle-swatch"
            style={{ backgroundColor: stop.value }}
            onClick={() => onPick(stop.value)}
          />
        ))}
      </>
    );
  }
  if (control.kind === 'stepper') {
    return (
      <>
        <span
          className="subtitle-step"
          aria-hidden="true"
          data-testid={`${rowKey(row.id)}-less`}
          onClick={() => onStep(-1)}
        >
          <ChevronLeft size={36} />
        </span>
        <span className="subtitle-percent" data-testid={`${rowKey(row.id)}-value`}>
          {t('settings.subtitles.percent', { percent: String(value) })}
        </span>
        <span
          className="subtitle-step"
          aria-hidden="true"
          data-testid={`${rowKey(row.id)}-more`}
          onClick={() => onStep(1)}
        >
          <ChevronRight size={36} />
        </span>
      </>
    );
  }
  return <span className="subtitle-switch" data-on={value === true} aria-hidden="true" />;
}

/**
 * Silo's "subtitle appearance" dialog for a TV: a live preview over the settings as rows. Every
 * row is one focus stop: Left and Right change its value (a chip, a swatch, 5 % of an opacity, the
 * outline off or on) and the change is saved at once, as the web app saves; OK toggles the
 * outline. The look is the profile's, the same on every device. Back closes the dialog and the
 * focus returns to what had it before.
 */
export function SubtitleAppearanceDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { appearance: look, change, reset } = useSubtitleAppearance();
  const body = useRef<HTMLDivElement>(null);
  // What had the focus before the dialog opened; read once, while the dialog is mounting.
  const [previous] = useState(() => getCurrentFocusKey());
  useBackHandler(onClose);

  const rows = ROWS.filter((row) => !row.boxOnly || look.backgroundStyle === 'box');
  const styleKey = rowKey('style');
  const stops = [...rows.map((row) => rowKey(row.id)), RESET_KEY];

  // The dialog takes the focus one task after it appears: the press that opened it is still being
  // handled by the navigation and must not land on the first row.
  useEffect(() => {
    const timer = setTimeout(() => void setFocus(stops[0]!), 0);
    return () => clearTimeout(timer);
    // Once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(
    () => () => {
      if (previous && doesFocusableExist(previous)) void setFocus(previous);
    },
    [previous],
  );
  // A style that hides the background rows (set on another device, or by a read that came in late)
  // must not leave the focus on one of them.
  const boxRows = look.backgroundStyle === 'box';
  useEffect(() => {
    if (boxRows) return;
    const focused = getCurrentFocusKey();
    if (focused === rowKey('backgroundOpacity') || focused === rowKey('backgroundColor')) {
      void setFocus(styleKey);
    }
  }, [boxRows, styleKey]);

  const pick = (row: RowDef, value: string | number | boolean) => {
    if (look[row.field] !== value) change({ [row.field]: value });
  };
  const step = (row: RowDef, direction: 1 | -1) => {
    const { control } = row;
    const current = look[row.field];
    if (control.kind === 'chips' || control.kind === 'swatches') {
      pick(
        row,
        stepValue(
          control.stops.map((stop) => stop.value),
          current as string,
          direction,
        ),
      );
    } else if (control.kind === 'stepper') {
      pick(row, stepOpacity(current as number, direction, control.range));
    } else {
      // Right switches on, Left switches off.
      pick(row, direction === 1);
    }
  };

  const arrows: ArrowHandler = (direction, fromKey) => {
    const at = stops.indexOf(fromKey);
    if (direction === 'up' || direction === 'down') {
      const target = stops[at + (direction === 'down' ? 1 : -1)];
      // The first row and the reset button are the ends of the dialog: there is nothing to move
      // to, and the dialog is a focus boundary, so the press goes nowhere.
      return target !== undefined && moveFocusTo(target);
    }
    const row = rows[at];
    if (row) step(row, direction === 'right' ? 1 : -1);
    return true;
  };

  // A key press scrolls the focused row into view (the pointer never does); the first row also
  // shows the heading above it.
  const keepInView = (index: number, key: string) => () => {
    if (focusFromPointer() || !body.current) return;
    if (index === 0) body.current.scrollTop = 0;
    else {
      Array.from(body.current.querySelectorAll('[data-focus-key]'))
        .find((el) => el.getAttribute('data-focus-key') === key)
        ?.scrollIntoView?.({ block: 'nearest' });
    }
  };

  const content: ReactNode[] = [];
  let section: Section | null = null;
  rows.forEach((row, index) => {
    if (row.section !== section) {
      section = row.section;
      content.push(
        <h3 key={`title-${row.section}`} className="subtitle-section-title">
          {t(SECTION_TITLE[row.section])}
        </h3>,
      );
    }
    const { control } = row;
    const role =
      control.kind === 'switch'
        ? 'switch'
        : control.kind === 'stepper'
          ? 'spinbutton'
          : 'radiogroup';
    const aria =
      control.kind === 'stepper'
        ? {
            'aria-label': t(control.name),
            'aria-valuemin': control.range.min,
            'aria-valuemax': control.range.max,
            'aria-valuenow': look[row.field] as number,
            'aria-valuetext': t('settings.subtitles.percent', {
              percent: String(look[row.field]),
            }),
          }
        : control.kind === 'switch'
          ? { 'aria-label': t(control.name), 'aria-checked': look[row.field] === true }
          : { 'aria-label': t(row.label) };
    content.push(
      <Focusable
        key={row.id}
        focusKey={rowKey(row.id)}
        className="subtitle-row"
        data-testid={rowKey(row.id)}
        role={role}
        {...aria}
        onFocused={keepInView(index, rowKey(row.id))}
        onClick={() => {
          if (control.kind === 'switch') pick(row, look[row.field] !== true);
        }}
      >
        <span className="subtitle-row-label">{t(row.label)}</span>
        <span className="subtitle-row-control">
          <RowControl
            row={row}
            look={look}
            onPick={(value) => pick(row, value)}
            onStep={(direction) => step(row, direction)}
          />
        </span>
      </Focusable>,
    );
  });

  return (
    <SelfFocusing>
      <div className="dialog-backdrop" onClick={onClose}>
        <FocusGroup
          focusKey="subtitle-dialog"
          boundary
          autoRestoreFocus={false}
          className="subtitle-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="subtitle-dialog-title"
          data-testid="subtitle-dialog"
          onArrow={arrows}
          onClick={(event) => event.stopPropagation()}
        >
          <header className="subtitle-dialog-header">
            <p className="subtitle-eyebrow">{t('settings.subtitles.eyebrow')}</p>
            <h2 id="subtitle-dialog-title" className="subtitle-dialog-title">
              {t('settings.subtitles.title')}
            </h2>
          </header>
          <Preview look={look} />
          <div className="subtitle-dialog-body" ref={body}>
            {content}
          </div>
          <footer className="subtitle-dialog-footer">
            <Focusable
              focusKey={RESET_KEY}
              className="subtitle-reset"
              data-testid={RESET_KEY}
              onClick={reset}
            >
              <RotateCcw size={28} aria-hidden="true" />
              {t('settings.subtitles.reset')}
            </Focusable>
            <p className="subtitle-status">{t('settings.subtitles.status')}</p>
          </footer>
        </FocusGroup>
      </div>
    </SelfFocusing>
  );
}
