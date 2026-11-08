// jsdom has no layout, so every element measures 0x0 and spatial navigation cannot tell "below"
// from "beside". This adapter gives focusable elements a fake geometry instead:
//  - an element with data-rect="x,y,width,height" gets exactly that;
//  - the others are stacked top to bottom in document order, 1000 px apart;
//  - the focusable children of an element with data-columns="n" (the PIN pad has 3 columns and the
//    class "pad") form a grid of n columns inside the slot of the first child.
import type { NavigationOptions } from '../app/nav';

interface Measurable {
  node: HTMLElement;
}

function rect(x: number, y: number, width: number, height: number) {
  return { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height };
}

function measure(node: HTMLElement) {
  const explicit = node.dataset.rect?.split(',').map(Number);
  if (explicit && explicit.length === 4) {
    return rect(explicit[0]!, explicit[1]!, explicit[2]!, explicit[3]!);
  }
  const all = Array.from(document.querySelectorAll<HTMLElement>('[data-focus-key]'));
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
