// jsdom has no layout, so every element measures 0x0 and spatial navigation cannot tell "below"
// from "beside". This adapter gives focusable elements a fake geometry instead:
//  - an element with data-rect="x,y,width,height" gets exactly that;
//  - the others are stacked top to bottom in document order, 1000 px apart;
//  - the focusable children of an element with data-columns="n" (the PIN pad has 3 columns and the
//    class "pad") form a grid of n columns inside the slot of the first child;
//  - the focusables of the shell's top bar (class "topbar") and of a server row (class
//    "server-row": the server and its Remove button) and of a media row (class "row-strip": its
//    cards) form one row;
//  - the choice pills of the settings screen (class "settings-choices") form one row;
//  - the pills of a library tab (class "lib-pills") and its Browse toolbar form one row each, and
//    the letters of the alphabet rail (class "alpha-rail") stand in a column far to the right,
//    level with the first poster of the grid;
//  - a group (no focus key of its own) spans the focusable elements below it, like a real box.
import type { NavigationOptions } from '../app/nav';

interface Measurable {
  node: HTMLElement;
}

function rect(x: number, y: number, width: number, height: number) {
  return { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height };
}

function measure(node: HTMLElement): ReturnType<typeof rect> {
  const explicit = node.dataset.rect?.split(',').map(Number);
  if (explicit && explicit.length === 4) {
    return rect(explicit[0]!, explicit[1]!, explicit[2]!, explicit[3]!);
  }
  const all = Array.from(document.querySelectorAll<HTMLElement>('[data-focus-key]'));
  if (!node.dataset.focusKey) {
    const inside = all.filter((el) => node.contains(el)).map(measure);
    if (inside.length > 0) {
      const left = Math.min(...inside.map((r) => r.left));
      const top = Math.min(...inside.map((r) => r.top));
      const right = Math.max(...inside.map((r) => r.right));
      const bottom = Math.max(...inside.map((r) => r.bottom));
      return rect(left, top, right - left, bottom - top);
    }
  }
  const rail = node.closest<HTMLElement>('.alpha-rail');
  if (rail) {
    const letters = all.filter((el) => rail.contains(el));
    const poster = all.find((el) => el.closest('[data-columns]'));
    const top = (poster ? all.indexOf(poster) : 0) * 1000;
    return rect(5000, top + letters.indexOf(node) * 40, 40, 40);
  }
  const row = node.closest<HTMLElement>(
    '.topbar, .server-row, .row-strip, .detail-row, .detail-episode-strip, .lib-pills, .browse-toolbar, .settings-choices',
  );
  if (row) {
    const cells = all.filter((el) => row.contains(el));
    return rect(cells.indexOf(node) * 120, all.indexOf(cells[0]!) * 1000, 100, 100);
  }
  const grid = node.closest<HTMLElement>('[data-columns], .pad');
  if (grid) {
    const columns = Number(grid.dataset.columns) || 3;
    const cells = all.filter((el) => grid.contains(el));
    const index = cells.indexOf(node);
    const slot = all.indexOf(cells[0]!);
    return rect((index % columns) * 120, slot * 1000 + Math.floor(index / columns) * 100, 100, 100);
  }
  return rect(0, Math.max(0, all.indexOf(node)) * 1000, 100, 100);
}

export const fakeLayout: NavigationOptions = {
  layoutAdapter: {
    measureLayout: (component: unknown) => {
      const { node } = component as Measurable;
      return Promise.resolve({ ...measure(node), node });
    },
  } as unknown as NavigationOptions['layoutAdapter'],
};
