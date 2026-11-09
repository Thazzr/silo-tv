import { useState } from 'react';
import { thumbhashColor, thumbhashPreview } from './thumbhash';

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
 * What stands in for a protected picture (an unwatched episode's still). The real picture is never
 * requested: the card shows its decoded ThumbHash, which the browser smooths when it scales it up.
 * Without a usable hash it is the plain placeholder colour with an "eye off" mark.
 */
function ProtectedArt({ thumbhash }: { thumbhash?: string }) {
  const preview = thumbhashPreview(thumbhash);
  if (preview) {
    return (
      <span className="art art-protected" data-testid="art-protected">
        <img className="art-img" src={preview} alt="" />
      </span>
    );
  }
  const color = thumbhashColor(thumbhash);
  return (
    <span
      className="art art-protected"
      data-testid="art-protected"
      style={color ? { backgroundColor: color } : undefined}
    >
      <span className="art-hidden-mark" data-testid="art-hidden-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="40" height="40">
          <path
            d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12zM9.5 12a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0-5 0zM4 4l16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </span>
  );
}

/**
 * A card's picture. While the image loads the card shows the picture's average colour (from its
 * ThumbHash) and the image paints over it as soon as it is decoded. There is no fade: a per-picture
 * opacity transition promotes and demotes a compositor layer for every card on the TV. Without an
 * image, or when it fails, the card shows its title on a tile so it never stays blank. The failure
 * is remembered per URL: a new URL tries again. A `protect`ed picture (spoiler protection) is
 * never loaded: its blurred ThumbHash stands in.
 */
export function Artwork({
  src,
  thumbhash,
  title,
  protect = false,
}: {
  src: string | null;
  thumbhash?: string;
  title: string;
  protect?: boolean;
}) {
  if (!src) return <TitleTile title={title} />;
  if (protect) return <ProtectedArt thumbhash={thumbhash} />;
  return <ArtworkImage key={src} src={src} placeholder={thumbhashColor(thumbhash)} title={title} />;
}
