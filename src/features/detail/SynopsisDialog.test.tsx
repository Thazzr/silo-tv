import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCurrentFocusKey } from '../../app/nav';
import { KEY, pressKey } from '../../test/keys';
import { renderWithSilo } from '../../test/renderFlow';
import { SYNOPSIS_STEP, SynopsisDialog } from './SynopsisDialog';

// jsdom has no layout: the text box is 300 px high and the text as tall as the test says.
let textHeight = 1000;
const BOX_HEIGHT = 300;
const originals = {
  offset: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight'),
  client: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight'),
};
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('synopsis-full') ? textHeight : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('synopsis-scroll') ? BOX_HEIGHT : 0;
    },
  });
});
afterEach(() => {
  for (const [name, saved] of [
    ['offsetHeight', originals.offset],
    ['clientHeight', originals.client],
  ] as const) {
    if (saved) Object.defineProperty(HTMLElement.prototype, name, saved);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
  }
});

const text = () => screen.getByTestId('synopsis-full');
const shift = () =>
  -Number(/translateY\((-?\d+(?:\.\d+)?)px\)/.exec(text().style.transform)![1]) || 0;
const scrollBox = () => screen.getByTestId('synopsis-scroll');
const above = () => scrollBox().getAttribute('data-more-above');
const below = () => scrollBox().getAttribute('data-more-below');

async function open(onClose = vi.fn()) {
  renderWithSilo(
    <SynopsisDialog title="A Title" text={'Long text. '.repeat(50)} onClose={onClose} />,
  );
  await waitFor(() => expect(getCurrentFocusKey()).toBe('synopsis-close'));
  return onClose;
}

describe('SynopsisDialog scrolling', () => {
  it('scrolls a long text down in steps of three lines and back up, and stops at both ends', async () => {
    textHeight = 1000; // 700 px beyond the box
    await open();
    expect(shift()).toBe(0);
    // Up at the top does nothing.
    await pressKey(KEY.up);
    expect(shift()).toBe(0);
    await pressKey(KEY.down);
    expect(shift()).toBe(SYNOPSIS_STEP);
    await pressKey(KEY.down);
    expect(shift()).toBe(2 * SYNOPSIS_STEP);
    await pressKey(KEY.up);
    expect(shift()).toBe(SYNOPSIS_STEP);
    for (let i = 0; i < 8; i += 1) await pressKey(KEY.down);
    // The last step is short: the end of the text, never past it.
    expect(shift()).toBe(700);
    await pressKey(KEY.down);
    expect(shift()).toBe(700);
    for (let i = 0; i < 10; i += 1) await pressKey(KEY.up);
    expect(shift()).toBe(0);
    // The arrows never move the focus off Close.
    expect(getCurrentFocusKey()).toBe('synopsis-close');
  });

  it('does not react to Up and Down when the text fits', async () => {
    textHeight = 200;
    await open();
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    expect(shift()).toBe(0);
    await pressKey(KEY.up);
    expect(shift()).toBe(0);
    expect(above()).toBe('false');
    expect(below()).toBe('false');
    expect(getCurrentFocusKey()).toBe('synopsis-close');
  });

  it('fades the bottom while more text follows and the top once it has scrolled', async () => {
    textHeight = 1000;
    await open();
    expect([above(), below()]).toEqual(['false', 'true']);
    await pressKey(KEY.down);
    expect([above(), below()]).toEqual(['true', 'true']);
    for (let i = 0; i < 8; i += 1) await pressKey(KEY.down);
    expect([above(), below()]).toEqual(['true', 'false']);
    for (let i = 0; i < 10; i += 1) await pressKey(KEY.up);
    expect([above(), below()]).toEqual(['false', 'true']);
  });

  it('closes on OK and on the Close button, as before', async () => {
    textHeight = 1000;
    const onClose = await open();
    await pressKey(KEY.down);
    await pressKey(KEY.enter);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
