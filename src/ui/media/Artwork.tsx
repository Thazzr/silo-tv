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
  // Only a failure is state: a picture that loads needs no re-render (it paints over the colour).
  const [failed, setFailed] = useState(false);
  if (failed) return <TitleTile title={title} />;
  return (
    <span
      className="art"
      data-testid="art"
      style={placeholder ? { backgroundColor: placeholder } : undefined}
    >
      <img className="art-img" src={src} alt="" decoding="async" onError={() => setFailed(true)} />
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
 * ThumbHash) and the image paints over it as soon as it is decoded. There is no fade: a per-picture
 * opacity transition promotes and demotes a compositor layer for every card on the TV. Without an
 * image, or when it fails, the card shows its title on a tile so it never stays blank. The failure
 * is remembered per URL: a new URL tries again.
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
