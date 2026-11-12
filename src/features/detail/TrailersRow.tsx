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
import { extraCaption, extraKindLabel, type ItemVideo } from './extras';
import { DETAIL_INSET } from './layout';

export interface TrailersRowProps {
  videos: readonly ItemVideo[];
  /**
   * The title's own backdrop (reference and ThumbHash): what a card shows. Nothing is ever fetched
   * from YouTube or Google for a card; the viewer's OK hands the video to the TV's app.
   */
  backdrop: { url: string | undefined; thumbhash: string | undefined };
  memory: FocusIndexMemory;
  /** Any card got the focus (the page scrolls to this row). */
  onRowFocused: () => void;
  /** OK on a card. */
  onOpenYouTube: (videoId: string) => void;
}

const videoId = (video: ItemVideo) => video.site_key;

function TrailerCard({
  video,
  backdrop,
  focusKey,
  onFocused,
  onOpen,
}: {
  video: ItemVideo;
  backdrop: TrailersRowProps['backdrop'];
  focusKey: string;
  onFocused: () => void;
  onOpen: TrailersRowProps['onOpenYouTube'];
}) {
  const t = useT();
  const url = useMediaUrl();
  const caption = extraCaption(video.name, video.kind, t);
  const kind = extraKindLabel(video.kind, t);
  return (
    <CardFrame
      focusKey={focusKey}
      variant="landscape"
      label={`${caption}, ${t('extras.youtube')}`}
      onClick={() => onOpen(video.site_key)}
      onFocused={onFocused}
      art={<Artwork src={url(backdrop.url)} thumbhash={backdrop.thumbhash} title={caption} />}
      caption={
        <>
          <span className="card-title" data-testid="extra-title">
            {caption}
          </span>
          <span className="card-sub">
            {/* The kind says nothing new under a title that is the kind's own label. */}
            {caption === kind ? null : (
              <span className="trailer-kind-text" data-testid="extra-kind">
                {kind}
              </span>
            )}
            {video.is_official ? (
              <span className="trailer-official" data-testid="extra-official">
                {t('extras.official')}
              </span>
            ) : null}
          </span>
        </>
      }
    />
  );
}

/**
 * "Trailers & More" of a movie or series: the title's YouTube videos in the server's order, each
 * with its kind and, when official, an outlined "Official" badge. OK hands the video to the TV's
 * YouTube app.
 */
export const TrailersRow = memo(function TrailersRow({
  videos,
  backdrop,
  memory,
  onRowFocused,
  onOpenYouTube,
}: TrailersRowProps) {
  const t = useT();
  const renderCard = useCallback(
    (video: ItemVideo, ctx: CardContext) => (
      <TrailerCard
        video={video}
        backdrop={backdrop}
        focusKey={ctx.focusKey}
        onFocused={ctx.onFocused}
        onOpen={onOpenYouTube}
      />
    ),
    [backdrop, onOpenYouTube],
  );
  return (
    <Row
      rowId="trailers"
      title={t('detail.trailers')}
      shape="landscape"
      items={videos}
      getKey={videoId}
      memory={memory}
      inset={DETAIL_INSET}
      onRowFocused={onRowFocused}
      renderCard={renderCard}
    />
  );
});
