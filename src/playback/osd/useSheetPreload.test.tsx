import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSheetPreload } from './useSheetPreload';

const urls = [0, 1, 2, 3, 4, 5].map((n) => `https://silo.test/sheet/${n}.jpg`);

/** Every Image the hook creates; one that lost its src is released. */
let created: FakeImage[];
class FakeImage {
  src = '';
  onload: (() => void) | null = null;
  constructor() {
    created.push(this);
  }
  removeAttribute(name: string) {
    if (name === 'src') this.src = '';
  }
}
const live = () => created.filter((i) => i.src !== '').map((i) => i.src);

beforeEach(() => {
  created = [];
  vi.stubGlobal('Image', FakeImage);
});
afterEach(() => vi.unstubAllGlobals());

type Props = { current: number; hint: 1 | -1 | 0 };
const mount = (initial: Props) =>
  renderHook((p: Props) => useSheetPreload(urls, p.current, p.hint), { initialProps: initial });

describe('useSheetPreload', () => {
  it('loads the shown sheet and the next one forward', () => {
    mount({ current: 2, hint: 1 });
    expect(live()).toEqual([urls[2], urls[3]]);
  });

  it('loads the previous sheet as the next one when going back', () => {
    mount({ current: 2, hint: -1 });
    expect(live().sort()).toEqual([urls[1], urls[2]]);
  });

  it('never holds more than two sheets and lets go of the others as the sheet moves on', () => {
    const view = mount({ current: 0, hint: 1 });
    for (const current of [1, 2, 3, 4, 5]) {
      view.rerender({ current, hint: 1 });
      expect(live().length).toBeLessThanOrEqual(2);
    }
    expect(live()).toEqual([urls[5]]);
    // Each sheet was requested once: moving on does not reload the one that stays.
    expect(created).toHaveLength(6);
  });

  it('has no sheet beyond the ends', () => {
    mount({ current: 0, hint: -1 });
    expect(live()).toEqual([urls[0]]);
  });

  it('follows the direction the sheet moved when the caller has no hint', () => {
    const view = mount({ current: 3, hint: 0 });
    // First look: forward.
    expect(live()).toEqual([urls[3], urls[4]]);
    view.rerender({ current: 2, hint: 0 });
    expect(live().sort()).toEqual([urls[1], urls[2]]);
  });

  it('releases every sheet on unmount', () => {
    const view = mount({ current: 2, hint: 1 });
    view.unmount();
    expect(live()).toEqual([]);
  });
});
