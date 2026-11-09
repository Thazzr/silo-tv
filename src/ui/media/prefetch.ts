// Fetches pictures before their cards are mounted. The image objects are kept (a bounded number of
// them, the oldest first out) so the browser holds on to the decoded pictures until the card that
// shows the same URL appears; then the card's own <img> is answered from the cache.

const KEPT = 160;
const held = new Map<string, HTMLImageElement>();

export function prefetchImage(url: string | null): void {
  if (!url || held.has(url)) return;
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  held.set(url, image);
  if (held.size > KEPT) {
    const oldest = held.keys().next().value;
    if (oldest !== undefined) held.delete(oldest);
  }
}
