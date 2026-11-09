import { useState } from 'react';
import { thumbhashColor } from './thumbhash';

function ArtworkImage({
  src,
  placeholder,
  title,
}: {
  src: string;
  placeholder: string | null;
  title: string;
}) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  if (state === 'failed') return <TitleTile title={title} />;
  return (
    <span
      className="art"
      data-testid="art"
      data-state={state}
      style={placeholder ? { backgroundColor: placeholder } : undefined}
    >
      <img
        className="art-img"
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        onLoad={() => setState('loaded')}
        onError={() => setState('failed')}
      />
    </span>
  );
}

/** What stands in for a picture that is missing or failed: the title on a plain tile. */
function TitleTile({ title }: { title: string }) {
  return (
    <span className="art art-tile" data-testid="art-tile" aria-hidden="true">
      {title}
    </span>
  );
}

/**
 * A card's picture. While the image loads the card shows the picture's average colour (from its
 * ThumbHash) and the image fades in over it; without an image, or when it fails, the card shows its
 * title on a tile so it never stays blank. The failure is remembered per URL: a new URL tries again.
 */
export function Artwork({
  src,
  thumbhash,
  title,
}: {
  src: string | null;
  thumbhash?: string;
  title: string;
}) {
  if (!src) return <TitleTile title={title} />;
  return <ArtworkImage key={src} src={src} placeholder={thumbhashColor(thumbhash)} title={title} />;
}
