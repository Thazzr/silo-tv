import { memo, useCallback } from 'react';
import { useT } from '../../i18n';
import {
  Artwork,
  CardFrame,
  Row,
  useMediaUrl,
  type CardContext,
  type FocusIndexMemory,
} from '../../ui/media';
import {
  extraCaption,
  extraGroupLabel,
  extraRuntime,
  type ExtraGroup,
  type ItemExtra,
} from './extras';
import { DETAIL_INSET } from './layout';
import { SectionHead } from './SectionHead';

const extraId = (extra: ItemExtra) => extra.content_id;

function ExtraCard({
  extra,
  focusKey,
  onFocused,
  onPlay,
}: {
  extra: ItemExtra;
  focusKey: string;
  onFocused: () => void;
  onPlay: (contentId: string, caption: string) => void;
}) {
  const t = useT();
  const url = useMediaUrl();
  const caption = extraCaption(extra.title, extra.kind, t);
  return (
    <CardFrame
      focusKey={focusKey}
      variant="landscape"
      onClick={() => onPlay(extra.content_id, caption)}
      onFocused={onFocused}
      art={<Artwork src={url(extra.still_url)} thumbhash={extra.still_thumbhash} title={caption} />}
      caption={
        <>
          <span className="card-title" data-testid="extra-title">
            {caption}
          </span>
          <span className="card-sub" data-testid="extra-runtime">
            {extraRuntime(extra.duration_seconds)}
          </span>
        </>
      }
    />
  );
}

/** One kind's extras: the kind's heading over a row of stills. */
const ExtraGroupRow = memo(function ExtraGroupRow({
  group,
  memory,
  onRowFocused,
  onPlay,
}: {
  group: ExtraGroup;
  memory: FocusIndexMemory;
  onRowFocused: () => void;
  onPlay: (contentId: string, caption: string) => void;
}) {
  const t = useT();
  const renderCard = useCallback(
    (extra: ItemExtra, ctx: CardContext) => (
      <ExtraCard extra={extra} focusKey={ctx.focusKey} onFocused={ctx.onFocused} onPlay={onPlay} />
    ),
    [onPlay],
  );
  return (
    <Row
      rowId={`extras-${group.kind}`}
      title={extraGroupLabel(group.kind, t)}
      shape="landscape"
      items={group.extras}
      getKey={extraId}
      memory={memory}
      inset={DETAIL_INSET}
      onRowFocused={onRowFocused}
      renderCard={renderCard}
    />
  );
});

/**
 * "Extras" of a movie or series: the local files (trailers, featurettes, ...), one row per kind in
 * the server's order, like the web's blocks under their kind headings. OK plays an extra in the
 * player, as any title.
 */
export const ExtrasSection = memo(function ExtrasSection({
  groups,
  memory,
  onRowFocused,
  onPlay,
}: {
  groups: readonly ExtraGroup[];
  memory: FocusIndexMemory;
  /** Any card got the focus (the page scrolls to this section). */
  onRowFocused: () => void;
  /** OK on an extra. */
  onPlay: (contentId: string, caption: string) => void;
}) {
  const t = useT();
  return (
    <section className="detail-extras" data-testid="detail-extras">
      <SectionHead title={t('detail.extras')} testId="extras-head" />
      {groups.map((group) => (
        <ExtraGroupRow
          key={group.kind}
          group={group}
          memory={memory}
          onRowFocused={onRowFocused}
          onPlay={onPlay}
        />
      ))}
    </section>
  );
});
