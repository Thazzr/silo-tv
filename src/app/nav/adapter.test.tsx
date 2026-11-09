import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Focusable } from '.';
import { NavAdapter, scrollFocusedIntoView } from './adapter';
import * as origin from './origin';

afterEach(() => vi.restoreAllMocks());

describe('DOM focus', () => {
  it('never scrolls on its own', async () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    render(
      <Focusable focusKey="a" autoFocus>
        a
      </Focusable>,
    );
    await vi.waitFor(() => expect(focus).toHaveBeenCalled());
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });
});

function html(markup: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = markup;
  document.body.append(host);
  return host;
}

/** Gives an element a scroll box in jsdom, which has no layout. */
function layoutBox(
  el: HTMLElement,
  box: { top: number; bottom: number; scrollHeight?: number; scrollWidth?: number },
) {
  const state = { scrollTop: 0, scrollLeft: 0 };
  Object.defineProperties(el, {
    scrollTop: { get: () => state.scrollTop, set: (v: number) => (state.scrollTop = v) },
    scrollLeft: { get: () => state.scrollLeft, set: (v: number) => (state.scrollLeft = v) },
    scrollHeight: { value: box.scrollHeight ?? box.bottom - box.top },
    clientHeight: { value: box.bottom - box.top },
    scrollWidth: { value: box.scrollWidth ?? 100 },
    clientWidth: { value: 100 },
  });
  el.getBoundingClientRect = () =>
    ({ top: box.top, bottom: box.bottom, left: 0, right: 100 }) as DOMRect;
  return state;
}

/** jsdom has no scrolling element; this one is a tall document in a 1080 px window. */
function fakeRoot() {
  const root = { scrollHeight: 5000, clientHeight: 1080, scrollTop: 0 };
  Object.defineProperty(document, 'scrollingElement', { configurable: true, value: root });
  return root;
}

describe('NavAdapter measuring', () => {
  const service = { options: {} } as ConstructorParameters<typeof NavAdapter>[0];

  it('reads the box of a card from its slot without touching layout', async () => {
    const host = html('<div data-nav-rect="360,0,176,264"><button id="c">c</button></div>');
    const reads = vi.fn();
    for (const name of ['offsetLeft', 'offsetTop', 'offsetWidth', 'offsetHeight']) {
      Object.defineProperty(HTMLElement.prototype, name, {
        configurable: true,
        get() {
          reads(name);
          return 0;
        },
      });
    }
    try {
      const node = host.querySelector<HTMLElement>('#c')!;
      const layout = await new NavAdapter(service).measureLayout({ node } as never);
      expect(layout).toMatchObject({
        x: 360,
        y: 0,
        width: 176,
        height: 264,
        left: 360,
        right: 536,
      });
      expect(reads).not.toHaveBeenCalled();
      // Anything else is still measured through the DOM.
      const other = html('<button id="o">o</button>').querySelector<HTMLElement>('#o')!;
      await new NavAdapter(service).measureLayout({ node: other } as never);
      expect(reads).toHaveBeenCalled();
    } finally {
      for (const name of ['offsetLeft', 'offsetTop', 'offsetWidth', 'offsetHeight']) {
        delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
      }
    }
  });
});

describe('scrollFocusedIntoView', () => {
  it('leaves a box that scrolls by transform alone, without reading layout', () => {
    const host = html(
      '<div data-transform-scrolled="box"><div style="overflow:auto"><button id="c">c</button></div></div>',
    );
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect');
    scrollFocusedIntoView(host.querySelector<HTMLElement>('#c')!);
    expect(rect).not.toHaveBeenCalled();
  });

  it('does not scroll an overflowing element inside a box, even under a page marker', () => {
    const host = html(
      '<div data-transform-scrolled="page"><div data-transform-scrolled="box"><div id="inner" style="overflow:auto"><button id="c">c</button></div></div></div>',
    );
    const inner = host.querySelector<HTMLElement>('#inner')!;
    const state = layoutBox(inner, { top: 0, bottom: 100, scrollHeight: 900 });
    const node = host.querySelector<HTMLElement>('#c')!;
    node.getBoundingClientRect = () => ({ top: 500, bottom: 560, left: 0, right: 50 }) as DOMRect;
    scrollFocusedIntoView(node);
    expect(state.scrollTop).toBe(0);
  });

  it('does not scroll an overflowing ancestor above a page marker, nor the document', () => {
    const host = html(
      '<div id="outer" style="overflow:hidden"><div data-transform-scrolled="page"><button id="c">c</button></div></div>',
    );
    const outer = host.querySelector<HTMLElement>('#outer')!;
    const state = layoutBox(outer, { top: 0, bottom: 100, scrollHeight: 900 });
    const node = host.querySelector<HTMLElement>('#c')!;
    node.getBoundingClientRect = () => ({ top: 500, bottom: 560, left: 0, right: 50 }) as DOMRect;
    const root = fakeRoot();
    try {
      scrollFocusedIntoView(node);
      expect(state.scrollTop).toBe(0);
      expect(root.scrollTop).toBe(0);
    } finally {
      Reflect.deleteProperty(document, 'scrollingElement');
    }
  });

  it('scrolls a list that overflows so the focused element is in view', () => {
    const host = html('<div id="list" style="overflow-y:auto"><button id="c">c</button></div>');
    const list = host.querySelector<HTMLElement>('#list')!;
    const state = layoutBox(list, { top: 100, bottom: 400, scrollHeight: 900 });
    const node = host.querySelector<HTMLElement>('#c')!;
    node.getBoundingClientRect = () => ({ top: 450, bottom: 520, left: 0, right: 50 }) as DOMRect;
    scrollFocusedIntoView(node);
    // The element ends 24 px inside the list's bottom edge.
    expect(state.scrollTop).toBe(144);
  });

  it('stops at a page that scrolls by transform, and the document stays where it is', () => {
    const host = html(
      '<div data-transform-scrolled="page"><div id="pills" style="overflow:hidden"><button id="c">c</button></div></div>',
    );
    const pills = host.querySelector<HTMLElement>('#pills')!;
    // Overflowing sideways: the pill row scrolls inside the page.
    const state = layoutBox(pills, { top: 0, bottom: 100, scrollWidth: 500 });
    pills.getBoundingClientRect = () => ({ top: 0, bottom: 100, left: 0, right: 100 }) as DOMRect;
    const node = host.querySelector<HTMLElement>('#c')!;
    node.getBoundingClientRect = () => ({ top: 10, bottom: 60, left: 300, right: 320 }) as DOMRect;
    const root = fakeRoot();
    try {
      scrollFocusedIntoView(node);
      expect(state.scrollLeft).toBe(244);
      expect(root.scrollTop).toBe(0);
    } finally {
      Reflect.deleteProperty(document, 'scrollingElement');
    }
  });

  it('scrolls the document when the focused element is below the window', () => {
    const host = html('<button id="c">c</button>');
    const node = host.querySelector<HTMLElement>('#c')!;
    node.getBoundingClientRect = () => ({ top: 1100, bottom: 1200, left: 0, right: 50 }) as DOMRect;
    const root = fakeRoot();
    try {
      scrollFocusedIntoView(node);
      expect(root.scrollTop).toBe(1200 - (window.innerHeight - 24));
    } finally {
      Reflect.deleteProperty(document, 'scrollingElement');
    }
  });
});

describe('scrolling and the pointer', () => {
  it('brings a focused element into view with keys but leaves the scroll box alone for a hovered one', async () => {
    const host = html('<div id="box" style="overflow:auto"><button id="far">far</button></div>');
    const box = host.querySelector<HTMLElement>('#box')!;
    const state = layoutBox(box, { top: 0, bottom: 100, scrollHeight: 900 });
    const node = host.querySelector<HTMLElement>('#far')!;
    node.getBoundingClientRect = () => ({ top: 500, bottom: 560, left: 0, right: 50 }) as DOMRect;
    fakeRoot();
    const adapter = new NavAdapter({ options: {} } as ConstructorParameters<typeof NavAdapter>[0]);

    // The pointer's element is the focused one: nothing scrolls.
    vi.spyOn(origin, 'focusFromPointer').mockReturnValue(true);
    adapter.focusNode({ node } as never);
    expect(state.scrollTop).toBe(0);

    // Keys or code: the box follows the focus.
    vi.spyOn(origin, 'focusFromPointer').mockReturnValue(false);
    adapter.focusNode({ node } as never);
    expect(state.scrollTop).toBeGreaterThan(0);
  });
});
