import { thumbhashPreview } from '../../ui/media';

/**
 * The end screen's opaque background, under the mini player: the next episode's ThumbHash picture
 * scaled over the screen (the browser's own smoothing blurs it, no CSS filter) with a dark scrim
 * on top in the style sheet. Without a usable hash it is the plain dark colour.
 */
export function EndBackdrop({ thumbhash }: { thumbhash: string | undefined }) {
  const preview = thumbhashPreview(thumbhash);
  return (
    <div
      className="player-end-backdrop"
      data-testid="player-end-backdrop"
      style={preview ? { backgroundImage: `url("${preview}")` } : undefined}
    />
  );
}
