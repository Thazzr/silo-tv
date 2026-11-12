import type { ReactNode } from 'react';
import { Captions, ChevronDown, Disc3, Layers3, Volume2 } from 'lucide-react';
import { FocusGroup, moveFocusTo, type ArrowHandler } from '../../app/nav';
import { Button } from '../../app/ui';
import { useLanguage, useT } from '../../i18n';
import { versionLabel } from './pills';
import type { Pills } from './usePicks';

export type PillKind = 'edition' | 'version' | 'audio' | 'subtitles';

const pillKey = (kind: PillKind) => `detail-pill-${kind}`;

/**
 * The row under the action row of a movie or episode page, like the web's: the Edition and
 * Version pills (only when the title has several), then Audio and Subtitles, each with what it
 * currently says. OK opens the pill's list; Left and Right walk the row, and its ends hold the
 * focus. Up and Down leave it for the action row above and the blocks below.
 */
export function PillsRow({
  pills,
  onOpen,
  onFocused,
}: {
  pills: Pills;
  onOpen: (kind: PillKind) => void;
  onFocused: () => void;
}) {
  const t = useT();
  const lang = useLanguage();
  const { picker, audio, subtitles, version } = pills;

  const shown: { kind: PillKind; icon: ReactNode; label: string; value: string }[] = [];
  if (picker.editions) {
    shown.push({
      kind: 'edition',
      icon: <Layers3 size={30} aria-hidden="true" />,
      label: t('detail.pill.edition'),
      value: picker.editions.current.label,
    });
  }
  if (picker.versions) {
    shown.push({
      kind: 'version',
      icon: <Disc3 size={30} aria-hidden="true" />,
      label: t('detail.pill.version'),
      value: versionLabel(version, lang, t),
    });
  }
  if (audio) {
    shown.push({
      kind: 'audio',
      icon: <Volume2 size={30} aria-hidden="true" />,
      label: t('detail.pill.audio'),
      value: audio.summary,
    });
  }
  shown.push({
    kind: 'subtitles',
    icon: <Captions size={30} aria-hidden="true" />,
    label: t('detail.pill.subtitles'),
    value: subtitles.summary,
  });

  const keys = shown.map((pill) => pillKey(pill.kind));
  const onArrow: ArrowHandler = (direction, fromKey) => {
    if (direction !== 'left' && direction !== 'right') return false;
    const next = keys[keys.indexOf(fromKey) + (direction === 'right' ? 1 : -1)];
    // Past an end the press is left to the spatial search, which finds nothing beside the row.
    return next === undefined ? false : moveFocusTo(next);
  };

  return (
    <FocusGroup
      focusKey="detail-pills"
      enterable
      saveLastFocusedChild={false}
      onArrow={onArrow}
      className="detail-row detail-pills"
      role="group"
      data-testid="detail-pills"
    >
      {shown.map((pill) => (
        <Button
          key={pill.kind}
          focusKey={pillKey(pill.kind)}
          className="detail-pill detail-track"
          aria-haspopup="dialog"
          onFocused={onFocused}
          onClick={() => onOpen(pill.kind)}
          data-testid={`pill-${pill.kind}`}
        >
          {pill.icon}
          <span className="detail-track-label">{pill.label}</span>
          <span className="detail-track-value">{pill.value}</span>
          <ChevronDown size={26} aria-hidden="true" />
        </Button>
      ))}
    </FocusGroup>
  );
}
