import { useEffect, useRef } from 'react';

function release(image: HTMLImageElement): void {
  image.onload = null;
  image.removeAttribute('src');
}

/**
 * Keeps at most two sheets warm: the one in view and the next one in the scrub direction. Each is
 * an `Image` whose load puts the sheet in the browser's cache, so stepping into the next sheet
 * does not show a blank thumbnail; references to every other sheet are dropped so the TV can free
 * their decoded pixels. `hint` is the direction when it is known (a scrub's rate); with 0 it is
 * read from how the shown sheet moved last, forward at first.
 */
export function useSheetPreload(
  urls: readonly (string | null)[],
  current: number,
  hint: 1 | -1 | 0,
): void {
  const held = useRef(new Map<number, { image: HTMLImageElement; url: string }>());
  const last = useRef<{ sheet: number; direction: 1 | -1 }>({ sheet: current, direction: 1 });

  useEffect(() => {
    const before = last.current;
    const direction: 1 | -1 =
      hint !== 0
        ? hint
        : current !== before.sheet
          ? current > before.sheet
            ? 1
            : -1
          : before.direction;
    last.current = { sheet: current, direction };

    const wanted = new Set<number>();
    for (const index of [current, current + direction]) {
      if (urls[index]) wanted.add(index);
    }
    for (const [index, entry] of held.current) {
      if (wanted.has(index) && entry.url === urls[index]) continue;
      release(entry.image);
      held.current.delete(index);
    }
    for (const index of wanted) {
      if (held.current.has(index)) continue;
      const image = new Image();
      const url = urls[index]!;
      image.src = url;
      held.current.set(index, { image, url });
    }
  }, [urls, current, hint]);

  // Everything is let go when the card goes away.
  useEffect(() => {
    const images = held.current;
    return () => {
      for (const { image } of images.values()) release(image);
      images.clear();
    };
  }, []);
}
