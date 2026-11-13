import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCountdown } from './useCountdown';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe('useCountdown', () => {
  it('stands at the total while it is not active, and does not count', () => {
    const done = vi.fn();
    const { result } = renderHook(() => useCountdown(false, 10, done));
    expect(result.current).toBe(10);
    advance(30_000);
    expect(result.current).toBe(10);
    expect(done).not.toHaveBeenCalled();
  });

  it('counts down once a second and calls onDone once when it reaches 0', () => {
    const done = vi.fn();
    const { result } = renderHook(() => useCountdown(true, 10, done));
    expect(result.current).toBe(10);
    advance(1000);
    expect(result.current).toBe(9);
    advance(8000);
    expect(result.current).toBe(1);
    expect(done).not.toHaveBeenCalled();
    advance(1000);
    expect(result.current).toBe(0);
    expect(done).toHaveBeenCalledTimes(1);
    advance(5000);
    expect(result.current).toBe(0);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('starts over with its whole count each time it becomes active again', () => {
    const done = vi.fn();
    const { result, rerender } = renderHook(({ active }) => useCountdown(active, 10, done), {
      initialProps: { active: true },
    });
    advance(4000);
    expect(result.current).toBe(6);
    rerender({ active: false });
    advance(5000);
    rerender({ active: true });
    expect(result.current).toBe(10);
    advance(10_000);
    expect(done).toHaveBeenCalledTimes(1);
    // After a run that ended, a new run may call it again.
    rerender({ active: false });
    rerender({ active: true });
    advance(10_000);
    expect(done).toHaveBeenCalledTimes(2);
  });

  it('calls the latest onDone, not the one it started with', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ done }) => useCountdown(true, 3, done), {
      initialProps: { done: first },
    });
    advance(1000);
    rerender({ done: second });
    advance(2000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('stops its timer when it is no longer active', () => {
    const { rerender } = renderHook(({ active }) => useCountdown(active, 10, vi.fn()), {
      initialProps: { active: true },
    });
    expect(vi.getTimerCount()).toBe(1);
    rerender({ active: false });
    expect(vi.getTimerCount()).toBe(0);
  });
});
