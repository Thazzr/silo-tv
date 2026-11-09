import { memo, useCallback } from 'react';
import { useT } from '../../i18n';
import {
  Artwork,
  CardFrame,
  CardPill,
  Row,
  useMediaUrl,
  type FocusIndexMemory,
} from '../../ui/media';
import { DETAIL_INSET } from './layout';
import { extraCaption, extraKindLabel, extraRuntime, type ExtraEntry } from './extras';

export interface ExtrasRowProps {
  entries: readonly ExtraEntry[];
  /**
   * The title's own backdrop (reference and ThumbHash): what a YouTube card shows. Nothing is ever
   * fetched from YouTube or Google for a card; the viewer's OK hands the video to the TV's app.
   */
  backdrop: { url: string | undefined; thumbhash: string | undefined };
  memory: FocusIndexMemory;
  /** Any card got the focus (the page scrolls to this row). */
  onRowFocused: () => void;
  /** OK on a local extra. */
  onPlayExtra: (contentId: string, caption: string) => void;
  /** OK on a YouTube card. */
  onOpenYouTube: (videoId: string) => void;
}

function ExtraCard({
  entry,
  backdrop,
  focusKey,
  onFocused,
  onPlayExtra,
  onOpenYouTube,
}: {
  entry: ExtraEntry;
  backdrop: ExtrasRowProps['backdrop'];
  focusKey: string;
  onFocused: () => void;
  onPlayExtra: ExtrasRowProps['onPlayExtra'];
  onOpenYouTube: ExtrasRowProps['onOpenYouTube'];
}) {
  const t = useT();
  const url = useMediaUrl();
  if (entry.type === 'local') {
    const { extra } = entry;
    const caption = extraCaption(extra.title, extra.kind, t);
    return (
      <CardFrame
        focusKey={focusKey}
        variant="landscape"
        onClick={() => onPlayExtra(extra.content_id, caption)}
        onFocused={onFocused}
        art={
          <Artwork src={url(extra.still_url)} thumbhash={extra.still_thumbhash} title={caption} />
        }
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
  const { video } = entry;
  const caption = extraCaption(video.name, video.kind, t);
  const kind = extraKindLabel(video.kind, t);
  return (
    <CardFrame
      focusKey={focusKey}
      variant="landscape"
      label={`${caption}, ${t('extras.youtube')}`}
      onClick={() => onOpenYouTube(entry.videoId)}
      onFocused={onFocused}
      art={
        <>
          <Artwork src={url(backdrop.url)} thumbhash={backdrop.thumbhash} title={caption} />
          <CardPill place="start" text={t('extras.youtube')} />
          {video.is_official ? <CardPill place="end" text={t('extras.official')} /> : null}
        </>
      }
      caption={
        <>
          <span className="card-title" data-testid="extra-title">
            {caption}
          </span>
          <span className="card-sub" data-testid="extra-runtime">
            {caption === kind ? '' : kind}
          </span>
        </>
      }
    />
  );
}

/** The "Trailer & More" row of a detail page: local extras first, then YouTube videos. */
export const ExtrasRow = memo(function ExtrasRow({
  entries,
  backdrop,
  memory,
  onRowFocused,
  onPlayExtra,
  onOpenYouTube,
}: ExtrasRowProps) {
  const t = useT();
  const getKey = useCallback((entry: ExtraEntry) => entry.key, []);
  const renderCard = useCallback(
    (entry: ExtraEntry, ctx: { focusKey: string; onFocused: () => void }) => (
      <ExtraCard
        entry={entry}
        backdrop={backdrop}
        focusKey={ctx.focusKey}
        onFocused={ctx.onFocused}
        onPlayExtra={onPlayExtra}
        onOpenYouTube={onOpenYouTube}
      />
    ),
    [backdrop, onPlayExtra, onOpenYouTube],
  );
  return (
    <Row
      rowId="extras"
      title={t('detail.extras')}
      shape="landscape"
      items={entries}
      getKey={getKey}
      memory={memory}
      inset={DETAIL_INSET}
      onRowFocused={onRowFocused}
      renderCard={renderCard}
    />
  );
});
