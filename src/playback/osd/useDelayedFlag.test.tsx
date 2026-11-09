import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDelayedFlag } from './useDelayedFlag';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

function setup(on: boolean) {
  return renderHook(({ on: value }) => useDelayedFlag(value, 500, 500), {
    initialProps: { on },
  });
}

describe('useDelayedFlag', () => {
  it('turns on only after the delay', () => {
    const { result, rerender } = setup(false);
    rerender({ on: true });
    advance(499);
    expect(result.current).toBe(false);
    advance(1);
    expect(result.current).toBe(true);
  });

  it('shows nothing for a stall shorter than the delay', () => {
    const { result, rerender } = setup(false);
    rerender({ on: true });
    advance(300);
    rerender({ on: false });
    advance(2000);
    expect(result.current).toBe(false);
  });

  it('stays on for the minimum time once shown', () => {
    const { result, rerender } = setup(false);
    rerender({ on: true });
    advance(500);
    expect(result.current).toBe(true);
    // The stall ends right away: it still stays 500 ms.
    rerender({ on: false });
    advance(499);
    expect(result.current).toBe(true);
    advance(1);
    expect(result.current).toBe(false);
  });

  it('goes at once when it was shown for longer than the minimum', () => {
    const { result, rerender } = setup(false);
    rerender({ on: true });
    advance(500);
    advance(3000);
    rerender({ on: false });
    advance(0);
    expect(result.current).toBe(false);
  });
});
