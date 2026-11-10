// The popover's focus claim: it comes one task after the mount, and not at all when the menu is
// gone by then.
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import { getCurrentFocusKey } from '../../app/nav';
import { memoryStorage, renderWithSilo } from '../../test/renderFlow';
import { MenuPopover, MenuRow } from './MenuPopover';

afterEach(() => cleanup());

const popover = (recall: () => string | null) => (
  <MenuPopover
    label="Menu"
    testId="t"
    rows={['row-a', 'row-b']}
    fallback="row-b"
    remember={() => {}}
    recall={recall}
    onSide={() => {}}
  >
    <MenuRow focusKey="row-a">A</MenuRow>
    <MenuRow focusKey="row-b">B</MenuRow>
  </MenuPopover>
);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('the focus claim of a popover', () => {
  it('lands on the fallback row one task after it mounts', async () => {
    const recall = vi.fn(() => null);
    renderWithSilo(popover(recall), { session: new Session(memoryStorage()) });
    // Not in the same task: the key that opened the menu is still being handled.
    // Not in the same task: the key that opened the menu is still being handled.
    expect(getCurrentFocusKey()).not.toBe('row-b');
    await wait(50);
    expect(recall).toHaveBeenCalledTimes(1);
    expect(getCurrentFocusKey()).toBe('row-b');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('prefers the remembered row when it exists', async () => {
    renderWithSilo(
      popover(() => 'row-a'),
      { session: new Session(memoryStorage()) },
    );
    await wait(50);
    expect(getCurrentFocusKey()).toBe('row-a');
  });

  it('falls back when the remembered row is gone', async () => {
    renderWithSilo(
      popover(() => 'row-gone'),
      { session: new Session(memoryStorage()) },
    );
    await wait(50);
    expect(getCurrentFocusKey()).toBe('row-b');
  });

  it('does not claim the focus when it unmounts within the same task: no timer is left', () => {
    vi.useFakeTimers();
    try {
      const mounted = renderWithSilo(
        popover(() => null),
        {
          session: new Session(memoryStorage()),
        },
      );
      mounted.unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
