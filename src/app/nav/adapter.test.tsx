import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('measures a group from below the part that a floating bar covers', async () => {
    const host = html(
      '<div id="g" data-nav-rect="0,0,1920,1080" data-nav-inset-top="141"><button>c</button></div>',
    );
    const node = host.querySelector<HTMLElement>('#g')!;
    const layout = await new NavAdapter(service).measureLayout({ node } as never);
    expect(layout).toMatchObject({
      y: 141,
      top: 141,
      height: 939,
      bottom: 1080,
      x: 0,
      width: 1920,
    });
    // Without the attribute the box is whole.
    const plain = html(
      '<div id="p" data-nav-rect="0,0,1920,1080"></div>',
    ).querySelector<HTMLElement>('#p')!;
    expect(await new NavAdapter(service).measureLayout({ node: plain } as never)).toMatchObject({
      y: 0,
      height: 1080,
    });
  });

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

describe('scroll-margin of the focused element', () => {
  /** jsdom resolves no `scroll-margin`; this answers it for one node and the rest as usual. */
  function withScrollMargin(node: HTMLElement, bottom: string) {
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
      const style = real(el, pseudo);
      return el === node
        ? new Proxy(style, {
            get: (target, prop) =>
              prop === 'scrollMarginBottom' ? bottom : Reflect.get(target, prop),
          })
        : style;
    });
  }

  it('keeps the element that far from the bottom of the window when the document scrolls', () => {
    const host = html('<button id="c">c</button>');
    const node = host.querySelector<HTMLElement>('#c')!;
    node.getBoundingClientRect = () => ({ top: 1000, bottom: 1070, left: 0, right: 50 }) as DOMRect;
    withScrollMargin(node, '54px');
    const root = fakeRoot();
    try {
      scrollFocusedIntoView(node);
      expect(root.scrollTop).toBe(1070 - (window.innerHeight - 54));
    } finally {
      Reflect.deleteProperty(document, 'scrollingElement');
      vi.restoreAllMocks();
    }
  });

  it('keeps the element that far from the bottom of a scrolling list', () => {
    const host = html('<div id="list" style="overflow-y:auto"><button id="c">c</button></div>');
    const list = host.querySelector<HTMLElement>('#list')!;
    const state = layoutBox(list, { top: 100, bottom: 400, scrollHeight: 900 });
    const node = host.querySelector<HTMLElement>('#c')!;
    node.getBoundingClientRect = () => ({ top: 300, bottom: 380, left: 0, right: 50 }) as DOMRect;
    withScrollMargin(node, '54px');
    try {
      scrollFocusedIntoView(node);
      expect(state.scrollTop).toBe(380 - (400 - 54));
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('never keeps less than the usual edge room', () => {
    const host = html('<button id="c">c</button>');
    const node = host.querySelector<HTMLElement>('#c')!;
    node.getBoundingClientRect = () => ({ top: 1000, bottom: 1070, left: 0, right: 50 }) as DOMRect;
    withScrollMargin(node, '4px');
    const root = fakeRoot();
    try {
      scrollFocusedIntoView(node);
      expect(root.scrollTop).toBe(1070 - (window.innerHeight - 24));
    } finally {
      Reflect.deleteProperty(document, 'scrollingElement');
      vi.restoreAllMocks();
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

// --- Hardening: exact boxes, edge cases of the scroll maths -----------------------------------------

const OFFSET_PROPS = ['offsetLeft', 'offsetTop', 'offsetWidth', 'offsetHeight'] as const;

/** Runs `fn` with the offset reads of the DOM counted, so a slot-box read can be told from a DOM one. */
async function countingDomReads<T>(fn: () => Promise<T>): Promise<{ value: T; reads: number }> {
  let reads = 0;
  for (const name of OFFSET_PROPS) {
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get() {
        reads += 1;
        return 0;
      },
    });
  }
  try {
    const value = await fn();
    return { value, reads };
  } finally {
    for (const name of OFFSET_PROPS) {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
    }
  }
}

describe('NavAdapter measuring: the slot box', () => {
  const service = { options: {} } as ConstructorParameters<typeof NavAdapter>[0];
  const measure = (node: HTMLElement | undefined) =>
    countingDomReads(() => new NavAdapter(service).measureLayout({ node } as never));

  it('gives every edge of the box, from its position and size', async () => {
    const host = html('<div data-nav-rect="10,20,30,40"><button id="c">c</button></div>');
    const { value, reads } = await measure(host.querySelector<HTMLElement>('#c')!);
    expect(reads).toBe(0);
    expect(value).toMatchObject({
      x: 10,
      y: 20,
      width: 30,
      height: 40,
      left: 10,
      top: 20,
      right: 40,
      bottom: 60,
    });
  });

  it('finds the slot when the node is the slot itself', async () => {
    const host = html('<button id="c" data-nav-rect="1,2,3,4">c</button>');
    const { value, reads } = await measure(host.querySelector<HTMLElement>('#c')!);
    expect(reads).toBe(0);
    expect(value).toMatchObject({ x: 1, y: 2, width: 3, height: 4 });
  });

  it.each([
    ['too few numbers', '1,2,3'],
    ['too many numbers', '1,2,3,4,5'],
    ['an empty value', ''],
    ['a number that is no number', '1,2,abc,4'],
    ['an infinite number', '1,2,Infinity,4'],
  ])('measures through the DOM when the slot holds %s', async (_name, value) => {
    const host = html(`<div data-nav-rect="${value}"><button id="c">c</button></div>`);
    const { reads } = await measure(host.querySelector<HTMLElement>('#c')!);
    expect(reads).toBeGreaterThan(0);
  });

  it('does not throw for a component without a node', async () => {
    await expect(measure(undefined)).resolves.toBeDefined();
  });
});

/** Gives an element a scroll box that may be redefined and removed again (document elements too). */
function tempBox(
  el: HTMLElement,
  box: { top: number; bottom: number; scrollHeight: number; scrollWidth?: number },
) {
  const state = { scrollTop: 0, scrollLeft: 0 };
  const own: Record<string, PropertyDescriptor> = {
    scrollTop: {
      configurable: true,
      get: () => state.scrollTop,
      set: (v: number) => (state.scrollTop = v),
    },
    scrollLeft: {
      configurable: true,
      get: () => state.scrollLeft,
      set: (v: number) => (state.scrollLeft = v),
    },
    scrollHeight: { configurable: true, value: box.scrollHeight },
    clientHeight: { configurable: true, value: box.bottom - box.top },
    scrollWidth: { configurable: true, value: box.scrollWidth ?? 100 },
    clientWidth: { configurable: true, value: 100 },
    getBoundingClientRect: {
      configurable: true,
      value: () => ({ top: box.top, bottom: box.bottom, left: 0, right: 100 }) as DOMRect,
    },
  };
  Object.defineProperties(el, own);
  return {
    state,
    undo: () => {
      for (const key of Object.keys(own)) Reflect.deleteProperty(el, key);
    },
  };
}

function nodeAt(
  host: HTMLElement,
  rect: { top: number; bottom: number; left?: number; right?: number },
) {
  const node = host.querySelector<HTMLElement>('#c')!;
  node.getBoundingClientRect = () => ({ left: 0, right: 50, ...rect }) as DOMRect;
  return node;
}

/** jsdom resolves neither `scroll-margin` nor `scroll-padding`; this answers them for one element. */
function withStyles(target: Element, values: Record<string, string>) {
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
    const style = real(el, pseudo);
    return el === target
      ? new Proxy(style, {
          get: (t, prop) =>
            typeof prop === 'string' && prop in values ? values[prop] : Reflect.get(t, prop),
        })
      : style;
  });
}

describe('scrollFocusedIntoView: the list scroll maths', () => {
  /** A list at 100..400 on screen; the room for a focused element is 124..376. */
  function list(extraStyle = 'overflow-y:auto') {
    const host = html(`<div id="list" style="${extraStyle}"><button id="c">c</button></div>`);
    const state = layoutBox(host.querySelector<HTMLElement>('#list')!, {
      top: 100,
      bottom: 400,
      scrollHeight: 900,
    });
    return { host, state };
  }

  it('scrolls back by the distance an element starts before the room', () => {
    const { host, state } = list();
    scrollFocusedIntoView(nodeAt(host, { top: 110, bottom: 150 }));
    expect(state.scrollTop).toBe(-14);
  });

  it('shows the start of an element that is taller than the room', () => {
    const { host, state } = list();
    scrollFocusedIntoView(nodeAt(host, { top: 200, bottom: 500 }));
    expect(state.scrollTop).toBe(76);
  });

  it('scrolls forward by the distance an element ends after the room', () => {
    const { host, state } = list();
    scrollFocusedIntoView(nodeAt(host, { top: 300, bottom: 420 }));
    expect(state.scrollTop).toBe(44);
  });

  it('leaves an element that is inside the room where it is', () => {
    const { host, state } = list();
    scrollFocusedIntoView(nodeAt(host, { top: 150, bottom: 200 }));
    expect(state.scrollTop).toBe(0);
  });

  it('keeps the margin the stylesheet asks for at the top', () => {
    const { host, state } = list();
    const node = nodeAt(host, { top: 130, bottom: 170 });
    withStyles(node, { scrollMarginTop: '54px' });
    scrollFocusedIntoView(node);
    // Room starts at 100 + 54, not at 100 + 24.
    expect(state.scrollTop).toBe(-24);
  });

  it('scrolls sideways by the distance an element starts before the room', () => {
    const { host, state } = list();
    scrollFocusedIntoView(nodeAt(host, { top: 150, bottom: 200, left: 10, right: 40 }));
    // The list spans 0..100 across, so the room is 24..76.
    expect(state.scrollLeft).toBe(-14);
  });

  it('scrolls sideways by the distance an element ends after the room', () => {
    const { host, state } = list();
    scrollFocusedIntoView(nodeAt(host, { top: 150, bottom: 200, left: 60, right: 90 }));
    expect(state.scrollLeft).toBe(14);
  });
});

describe('scrollFocusedIntoView: what counts as a scroll container', () => {
  it('leaves an element alone whose content fits, even when it could scroll', () => {
    const host = html('<div id="list" style="overflow:auto"><button id="c">c</button></div>');
    // Content as high and as wide as the box.
    const state = layoutBox(host.querySelector<HTMLElement>('#list')!, {
      top: 100,
      bottom: 400,
      scrollHeight: 300,
    });
    scrollFocusedIntoView(nodeAt(host, { top: 500, bottom: 560 }));
    expect(state.scrollTop).toBe(0);
    expect(state.scrollLeft).toBe(0);
  });

  it('leaves an element alone whose content is lower than the box and as wide', () => {
    const host = html('<div id="list" style="overflow:auto"><button id="c">c</button></div>');
    const state = layoutBox(host.querySelector<HTMLElement>('#list')!, {
      top: 100,
      bottom: 400,
      scrollHeight: 200,
    });
    scrollFocusedIntoView(nodeAt(host, { top: 500, bottom: 560 }));
    expect(state.scrollTop).toBe(0);
  });

  it.each(['visible', 'clip'])('does not scroll an element with overflow %s', (overflow) => {
    const host = html(
      `<div id="list" style="overflow:${overflow}"><button id="c">c</button></div>`,
    );
    const state = layoutBox(host.querySelector<HTMLElement>('#list')!, {
      top: 100,
      bottom: 400,
      scrollHeight: 900,
    });
    scrollFocusedIntoView(nodeAt(host, { top: 500, bottom: 560 }));
    expect(state.scrollTop).toBe(0);
  });

  it.each(['auto', 'scroll', 'hidden'])('scrolls an element with overflow %s', (overflow) => {
    const host = html(
      `<div id="list" style="overflow:${overflow}"><button id="c">c</button></div>`,
    );
    const state = layoutBox(host.querySelector<HTMLElement>('#list')!, {
      top: 100,
      bottom: 400,
      scrollHeight: 900,
    });
    scrollFocusedIntoView(nodeAt(host, { top: 500, bottom: 560 }));
    expect(state.scrollTop).toBeGreaterThan(0);
  });

  it('never scrolls the body, but goes on to the document', () => {
    const host = html('<button id="c">c</button>');
    const node = nodeAt(host, { top: 1100, bottom: 1200 });
    const box = tempBox(document.body, { top: 0, bottom: 1080, scrollHeight: 5000 });
    document.body.style.overflow = 'auto';
    const root = fakeRoot();
    try {
      scrollFocusedIntoView(node);
      expect(box.state.scrollTop).toBe(0);
      expect(root.scrollTop).toBe(1200 - (window.innerHeight - 24));
    } finally {
      document.body.style.overflow = '';
      box.undo();
      Reflect.deleteProperty(document, 'scrollingElement');
    }
  });

  it('never scrolls the root element through the ancestor walk', () => {
    const node = document.createElement('button');
    node.id = 'c';
    document.documentElement.append(node);
    const box = tempBox(document.documentElement, { top: 0, bottom: 1080, scrollHeight: 5000 });
    document.documentElement.style.overflow = 'auto';
    // No document scrolling either, so only the ancestor walk could move the root element.
    Object.defineProperty(document, 'scrollingElement', { configurable: true, value: null });
    try {
      node.getBoundingClientRect = () =>
        ({ top: 1100, bottom: 1200, left: 0, right: 50 }) as DOMRect;
      scrollFocusedIntoView(node);
      expect(box.state.scrollTop).toBe(0);
    } finally {
      Reflect.deleteProperty(document, 'scrollingElement');
      document.documentElement.style.overflow = '';
      box.undo();
      node.remove();
    }
  });
});

describe('scrollFocusedIntoView: the document', () => {
  function documentCase(root: object | null, rect: { top: number; bottom: number }) {
    const host = html('<button id="c">c</button>');
    const node = nodeAt(host, rect);
    Object.defineProperty(document, 'scrollingElement', { configurable: true, value: root });
    return node;
  }
  afterEach(() => Reflect.deleteProperty(document, 'scrollingElement'));

  it('does nothing without a scrolling element', () => {
    const node = documentCase(null, { top: 1100, bottom: 1200 });
    expect(() => scrollFocusedIntoView(node)).not.toThrow();
  });

  it('does nothing when the document is exactly as high as the window', () => {
    const root = { scrollHeight: 1080, clientHeight: 1080, scrollTop: 0 };
    const node = documentCase(root, { top: 1100, bottom: 1200 });
    scrollFocusedIntoView(node);
    expect(root.scrollTop).toBe(0);
  });

  it('does nothing when the document is lower than the window', () => {
    const root = { scrollHeight: 500, clientHeight: 1080, scrollTop: 0 };
    const node = documentCase(root, { top: 1100, bottom: 1200 });
    scrollFocusedIntoView(node);
    expect(root.scrollTop).toBe(0);
  });

  it('keeps the scroll padding of the document at the top', () => {
    const root = { scrollHeight: 5000, clientHeight: 1080, scrollTop: 0 };
    const node = documentCase(root, { top: 50, bottom: 100 });
    withStyles(document.documentElement, { scrollPaddingTop: '80px' });
    scrollFocusedIntoView(node);
    expect(root.scrollTop).toBe(-30);
  });

  it('takes no padding when the document names none', () => {
    const root = { scrollHeight: 5000, clientHeight: 1080, scrollTop: 0 };
    const node = documentCase(root, { top: -10, bottom: 40 });
    scrollFocusedIntoView(node);
    expect(root.scrollTop).toBe(-10);
  });

  it('adds no padding to an element that starts at the very top', () => {
    const root = { scrollHeight: 5000, clientHeight: 1080, scrollTop: 0 };
    const node = documentCase(root, { top: 0, bottom: 40 });
    scrollFocusedIntoView(node);
    expect(root.scrollTop).toBe(0);
  });

  it('does not write the scroll position when nothing has to move', () => {
    let writes = 0;
    const root = {
      scrollHeight: 5000,
      clientHeight: 1080,
      get scrollTop() {
        return 0;
      },
      set scrollTop(_value: number) {
        writes += 1;
      },
    };
    const node = documentCase(root, { top: 200, bottom: 300 });
    scrollFocusedIntoView(node);
    expect(writes).toBe(0);
  });
});

describe('scrollFocusedIntoView: scrolling back up shows what stands above the focus', () => {
  // The document is searched for focusable elements, so the other tests' pages must be gone.
  beforeEach(() => document.body.replaceChildren());

  /**
   * A list at 100..400 on screen (room for the focused element: 124..376), scrolled by 400. The
   * markup is a focusable "above", plain text, the focused element, and a focusable below it.
   */
  function page(aboveMarkup = '<button id="above" data-focus-key="above">a</button>') {
    const host = html(
      `<div id="list" style="overflow-y:auto">${aboveMarkup}<p>heading</p>` +
        '<button id="c" data-focus-key="c">c</button>' +
        '<button id="below" data-focus-key="below">b</button></div>',
    );
    const state = layoutBox(host.querySelector<HTMLElement>('#list')!, {
      top: 100,
      bottom: 400,
      scrollHeight: 2000,
    });
    state.scrollTop = 400;
    return { host, state };
  }

  function place(host: HTMLElement, id: string, top: number, bottom: number) {
    const el = host.querySelector<HTMLElement>(`#${id}`)!;
    el.getBoundingClientRect = () =>
      ({ top, bottom, left: 0, right: 50, width: 50, height: bottom - top }) as DOMRect;
    return el;
  }

  it('scrolls to the very top when no focusable element is above', () => {
    const { host, state } = page('');
    state.scrollTop = 100;
    scrollFocusedIntoView(place(host, 'c', 90, 140));
    expect(state.scrollTop).toBe(0);
  });

  it('scrolls to the top for the first focusable element even when it already lies in the room', () => {
    const { host, state } = page('');
    state.scrollTop = 100;
    scrollFocusedIntoView(place(host, 'c', 124, 174));
    expect(state.scrollTop).toBe(0);
  });

  it('leaves an element in the room where it is when a focusable element is above', () => {
    const { host, state } = page();
    place(host, 'above', -100, -50);
    scrollFocusedIntoView(place(host, 'c', 124, 174));
    expect(state.scrollTop).toBe(400);
  });

  it('shows what lies between the focusable element above and the focused one', () => {
    const { host, state } = page();
    place(host, 'above', -100, -50);
    scrollFocusedIntoView(place(host, 'c', 80, 130));
    // The element above ends at the top edge of the list afterwards: 150 px up, not just 44.
    expect(state.scrollTop).toBe(250);
  });

  it('is limited by the room, and the focused element stays fully visible', () => {
    const { host, state } = page();
    place(host, 'above', -600, -500);
    scrollFocusedIntoView(place(host, 'c', 80, 330));
    // The element may move down only until it ends at the bottom of the room (376).
    expect(state.scrollTop).toBe(400 - 46);
  });

  it('shows the start of a focused element that is taller than the room, as before', () => {
    const { host, state } = page();
    place(host, 'above', -600, -500);
    scrollFocusedIntoView(place(host, 'c', 80, 500));
    expect(state.scrollTop).toBe(400 - 44);
  });

  it('does not scroll further than the way the room needs when the element above is in view', () => {
    const { host, state } = page();
    place(host, 'above', 40, 90);
    scrollFocusedIntoView(place(host, 'c', 100, 150));
    expect(state.scrollTop).toBe(400 - 24);
  });

  it('does not take a focusable element that comes after the focused one for the one above', () => {
    const { host, state } = page('');
    state.scrollTop = 100;
    place(host, 'below', -500, -450);
    scrollFocusedIntoView(place(host, 'c', 90, 140));
    expect(state.scrollTop).toBe(0);
  });

  it('does not take a neighbour in the same row for the focusable element above', () => {
    const { host, state } = page('<button id="left" data-focus-key="left">l</button>');
    state.scrollTop = 100;
    place(host, 'left', 90, 140);
    scrollFocusedIntoView(place(host, 'c', 90, 140));
    expect(state.scrollTop).toBe(0);
  });

  it('ignores elements the navigation does not know, disabled ones and ones without a box', () => {
    const { host, state } = page(
      '<button id="above" tabindex="0">plain</button>' +
        '<button id="off" data-focus-key="off" disabled>off</button>' +
        '<button id="gone" data-focus-key="gone">gone</button>',
    );
    state.scrollTop = 100;
    place(host, 'above', -300, -250);
    place(host, 'off', -300, -250);
    host.querySelector<HTMLElement>('#gone')!.getBoundingClientRect = () =>
      ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }) as DOMRect;
    scrollFocusedIntoView(place(host, 'c', 90, 140));
    expect(state.scrollTop).toBe(0);
  });

  it('ignores a bar that stays on screen above the content', () => {
    const { host, state } = page(
      '<div style="position:sticky"><button id="above" data-focus-key="above">bar</button></div>',
    );
    state.scrollTop = 100;
    place(host, 'above', 0, 50);
    scrollFocusedIntoView(place(host, 'c', 90, 140));
    expect(state.scrollTop).toBe(0);
  });

  it.each([
    [
      'the element itself',
      '<button id="above" data-focus-key="above" style="position:fixed">bar</button>',
    ],
    [
      'an ancestor inside the box',
      '<div style="position:fixed"><button id="above" data-focus-key="above">bar</button></div>',
    ],
  ])('ignores a fixed bar: %s', (_name, markup) => {
    const { host, state } = page(markup);
    state.scrollTop = 100;
    place(host, 'above', 0, 50);
    scrollFocusedIntoView(place(host, 'c', 90, 140));
    expect(state.scrollTop).toBe(0);
  });

  it('ignores a focusable element without room even when its box lies below the edge', () => {
    const { host, state } = page();
    state.scrollTop = 100;
    host.querySelector<HTMLElement>('#above')!.getBoundingClientRect = () =>
      ({ top: 20, bottom: 20, left: 0, right: 0, width: 0, height: 0 }) as DOMRect;
    scrollFocusedIntoView(place(host, 'c', 90, 140));
    expect(state.scrollTop).toBe(0);
  });

  it('does not count a focusable element outside the scrolling box', () => {
    const { host, state } = page('');
    state.scrollTop = 100;
    const outside = document.createElement('button');
    outside.setAttribute('data-focus-key', 'outside');
    outside.getBoundingClientRect = () =>
      ({ top: -900, bottom: -850, left: 0, right: 50, width: 50, height: 50 }) as DOMRect;
    host.before(outside);
    scrollFocusedIntoView(place(host, 'c', 90, 140));
    expect(state.scrollTop).toBe(0);
  });

  describe('a list in a fixed backdrop, as in a dialog or a menu', () => {
    function dialogList() {
      const host = html(
        '<div style="position:fixed"><div id="list" style="overflow-y:auto">' +
          '<button id="a" data-focus-key="a">a</button><button id="c" data-focus-key="c">c</button>' +
          '</div></div>',
      );
      const state = layoutBox(host.querySelector<HTMLElement>('#list')!, {
        top: 100,
        bottom: 400,
        scrollHeight: 2000,
      });
      state.scrollTop = 400;
      place(host, 'a', 130, 180);
      return { host, state };
    }

    it('leaves a scrolled list alone when the item is inside the room', () => {
      const { host, state } = dialogList();
      scrollFocusedIntoView(place(host, 'c', 200, 250));
      expect(state.scrollTop).toBe(400);
    });

    it('takes the list to the top for its first item', () => {
      const { host, state } = dialogList();
      state.scrollTop = 100;
      scrollFocusedIntoView(place(host, 'a', 130, 180));
      expect(state.scrollTop).toBe(0);
    });
  });

  it('scrolls the document to the top when no focusable element is above', () => {
    const host = html('<button id="c" data-focus-key="c">c</button>');
    const root = { scrollHeight: 5000, clientHeight: 1080, scrollTop: 300 };
    Object.defineProperty(document, 'scrollingElement', { configurable: true, value: root });
    withStyles(document.documentElement, { scrollPaddingTop: '160px' });
    try {
      scrollFocusedIntoView(nodeAt(host, { top: 100, bottom: 150 }));
      expect(root.scrollTop).toBe(0);
    } finally {
      Reflect.deleteProperty(document, 'scrollingElement');
    }
  });

  it('reveals what lies above a control in the document', () => {
    const host = html(
      '<button id="above" data-focus-key="above">a</button><p>heading</p>' +
        '<button id="c" data-focus-key="c">c</button>',
    );
    place(host, 'above', -300, -250);
    const root = { scrollHeight: 5000, clientHeight: 1080, scrollTop: 2000 };
    Object.defineProperty(document, 'scrollingElement', { configurable: true, value: root });
    withStyles(document.documentElement, { scrollPaddingTop: '160px' });
    try {
      scrollFocusedIntoView(place(host, 'c', 100, 150));
      // 160 - (-250): the element above ends at the padding edge afterwards.
      expect(root.scrollTop).toBe(2000 - 410);
    } finally {
      Reflect.deleteProperty(document, 'scrollingElement');
    }
  });

  it('leaves scrolling down alone', () => {
    const { host, state } = page();
    place(host, 'above', -100, -50);
    scrollFocusedIntoView(place(host, 'c', 300, 420));
    expect(state.scrollTop).toBe(400 + 44);
  });
});
