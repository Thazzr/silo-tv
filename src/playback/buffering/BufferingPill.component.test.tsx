// The buffering pill and its countdown hook on their own: markup, focus, clicks, the 15 s timer
// with its waits and its freeze, and the keys' building blocks.
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n';
import type { BufferingOffer } from '../session/BufferingManager';
import { BufferingPill } from './BufferingPill';
import { useBufferingPill } from './useBufferingPill';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const prompt: BufferingOffer = { kind: 'prompt', id: 1 };
const undo: BufferingOffer = { kind: 'undo', id: 2 };

function pill(props: Partial<Parameters<typeof BufferingPill>[0]> = {}) {
  const handlers = {
    onLower: vi.fn(),
    onKeep: vi.fn(),
    onRestore: vi.fn(),
    onFocus: vi.fn(),
  };
  const view = render(
    <I18nProvider lang="en">
      <BufferingPill
        offer={prompt}
        focused={false}
        choice="lower"
        raised={false}
        running
        elapsedMs={0}
        {...handlers}
        {...props}
      />
    </I18nProvider>,
  );
  return { ...handlers, view };
}

describe('BufferingPill', () => {
  it('draws the prompt with its title, two buttons and a 15 s countdown line', () => {
    pill({ elapsedMs: 5000, raised: true });
    const root = screen.getByTestId('player-buffering');
    expect(root).toHaveAttribute('data-kind', 'prompt');
    expect(root).toHaveAttribute('data-raised', 'true');
    expect(root).toHaveAttribute('aria-label', 'Playback keeps buffering');
    expect(root).toHaveTextContent('Playback keeps buffering');
    expect(screen.getByTestId('player-buffering-lower')).toHaveTextContent('Lower quality');
    expect(screen.getByTestId('player-buffering-keep')).toHaveTextContent('Keep quality');
    const line = screen.getByTestId('player-buffering-line');
    expect(line.style.animationDuration).toBe('15000ms');
    expect(line.style.animationDelay).toBe('-5000ms');
    expect(line).toHaveAttribute('data-running', 'true');
  });

  it('draws the undo pill with its own caption, one button and a plain raised flag', () => {
    pill({ offer: undo, focused: true, running: false });
    const root = screen.getByTestId('player-buffering');
    expect(root).toHaveAttribute('data-kind', 'undo');
    expect(root).toHaveAttribute('data-raised', 'false');
    expect(root).toHaveAttribute('aria-label', 'Quality lowered to stop buffering');
    expect(screen.getByTestId('player-buffering-restore')).toHaveTextContent('Restore quality');
    expect(screen.getByTestId('player-buffering-restore')).toHaveAttribute('data-focused', 'true');
    expect(screen.queryByTestId('player-buffering-lower')).toBeNull();
    expect(screen.getByTestId('player-buffering-line')).toHaveAttribute('data-running', 'false');
  });

  it('marks only the focused button of the prompt, and none when the pill has no focus', () => {
    const { view } = pill({ focused: true, choice: 'keep' });
    expect(screen.getByTestId('player-buffering-lower')).toHaveAttribute('data-focused', 'false');
    expect(screen.getByTestId('player-buffering-keep')).toHaveAttribute('data-focused', 'true');
    view.rerender(
      <I18nProvider lang="en">
        <BufferingPill
          offer={prompt}
          focused={false}
          choice="keep"
          raised={false}
          running
          elapsedMs={0}
          onLower={vi.fn()}
          onKeep={vi.fn()}
          onRestore={vi.fn()}
          onFocus={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(screen.getByTestId('player-buffering-keep')).toHaveAttribute('data-focused', 'false');
  });

  it('moves the DOM focus with the controls, without scrolling, and lets go of it', () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    const { view } = pill({ focused: true, choice: 'lower' });
    expect(screen.getByTestId('player-buffering-lower')).toHaveFocus();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    view.rerender(
      <I18nProvider lang="en">
        <BufferingPill
          offer={prompt}
          focused
          choice="keep"
          raised={false}
          running
          elapsedMs={0}
          onLower={vi.fn()}
          onKeep={vi.fn()}
          onRestore={vi.fn()}
          onFocus={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(screen.getByTestId('player-buffering-keep')).toHaveFocus();
    view.rerender(
      <I18nProvider lang="en">
        <BufferingPill
          offer={prompt}
          focused={false}
          choice="keep"
          raised={false}
          running
          elapsedMs={0}
          onLower={vi.fn()}
          onKeep={vi.fn()}
          onRestore={vi.fn()}
          onFocus={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(document.body).toHaveFocus();
    focus.mockRestore();
  });

  it('answers with the button that was clicked, and hover moves the choice', () => {
    const handlers = pill();
    fireEvent.click(screen.getByTestId('player-buffering-keep'));
    expect(handlers.onKeep).toHaveBeenCalledTimes(1);
    expect(handlers.onLower).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('player-buffering-lower'));
    expect(handlers.onLower).toHaveBeenCalledTimes(1);
    expect(handlers.onRestore).not.toHaveBeenCalled();
    fireEvent.mouseEnter(screen.getByTestId('player-buffering-keep'));
    expect(handlers.onFocus).not.toHaveBeenCalled();
    fireEvent.mouseMove(screen.getByTestId('player-buffering-keep'));
    expect(handlers.onFocus).toHaveBeenLastCalledWith('keep');
    fireEvent.mouseMove(screen.getByTestId('player-buffering-lower'));
    expect(handlers.onFocus).toHaveBeenLastCalledWith('lower');
  });

  it('the undo button restores on click, and hovering it focuses the pill', () => {
    const handlers = pill({ offer: undo });
    fireEvent.click(screen.getByTestId('player-buffering-restore'));
    expect(handlers.onRestore).toHaveBeenCalledTimes(1);
    expect(handlers.onKeep).not.toHaveBeenCalled();
    fireEvent.mouseMove(screen.getByTestId('player-buffering-restore'));
    expect(handlers.onFocus).toHaveBeenCalledWith('lower');
  });
});

describe('useBufferingPill', () => {
  function hook(initial: Partial<Parameters<typeof useBufferingPill>[0]> = {}) {
    vi.useFakeTimers();
    const answer = vi.fn();
    const shown = vi.fn();
    const result = renderHook((props) => useBufferingPill(props), {
      initialProps: {
        offer: prompt as BufferingOffer | null,
        slotFree: true,
        paused: false,
        answer,
        shown,
        ...initial,
      },
    });
    return { ...result, answer, shown };
  }

  it('expires after 15 s, on the dot, and reports itself shown once', () => {
    const { result, answer, shown } = hook();
    expect(result.current.visible).toBe(true);
    expect(shown).toHaveBeenCalledTimes(1);
    expect(shown).toHaveBeenCalledWith(1);
    act(() => void vi.advanceTimersByTime(14_999));
    expect(answer).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(answer).toHaveBeenCalledWith('expire');
  });

  it('waits while the slot is taken, reports itself shown, and starts its 15 s, only when it is free', () => {
    const { result, rerender, answer, shown } = hook({ slotFree: false });
    expect(result.current.visible).toBe(false);
    act(() => void vi.advanceTimersByTime(60_000));
    expect(shown).not.toHaveBeenCalled();
    expect(answer).not.toHaveBeenCalled();
    rerender({ offer: prompt, slotFree: true, paused: false, answer, shown });
    expect(shown).toHaveBeenCalledWith(1);
    act(() => void vi.advanceTimersByTime(14_999));
    expect(answer).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(answer).toHaveBeenCalledWith('expire');
  });

  it('freezes while paused, keeps the line where it was, and finishes the rest', () => {
    const { result, rerender, answer, shown } = hook();
    act(() => void vi.advanceTimersByTime(5000));
    rerender({ offer: prompt, slotFree: true, paused: true, answer, shown });
    expect(result.current.running).toBe(false);
    expect(result.current.elapsedMs).toBe(5000);
    act(() => void vi.advanceTimersByTime(60_000));
    expect(answer).not.toHaveBeenCalled();
    rerender({ offer: prompt, slotFree: true, paused: false, answer, shown });
    act(() => void vi.advanceTimersByTime(9_999));
    expect(answer).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(answer).toHaveBeenCalledWith('expire');
  });

  it('a second offer starts fresh: 15 s and the first button', () => {
    const { result, rerender, answer, shown } = hook();
    act(() => void result.current.move('right'));
    expect(result.current.choice).toBe('keep');
    act(() => void vi.advanceTimersByTime(10_000));
    rerender({ offer: { kind: 'prompt', id: 2 }, slotFree: true, paused: false, answer, shown });
    expect(result.current.choice).toBe('lower');
    expect(result.current.elapsedMs).toBe(0);
    act(() => void vi.advanceTimersByTime(14_999));
    expect(answer).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(answer).toHaveBeenCalledTimes(1);
    expect(shown).toHaveBeenLastCalledWith(2);
  });

  it('starts on the first button and moves between the two, with nowhere to go at the ends', () => {
    const { result } = hook();
    expect(result.current.choice).toBe('lower');
    let moved = true;
    act(() => void (moved = result.current.move('left')));
    expect(moved).toBe(false);
    act(() => void (moved = result.current.move('right')));
    expect(moved).toBe(true);
    expect(result.current.choice).toBe('keep');
    act(() => void (moved = result.current.move('right')));
    expect(moved).toBe(false);
    act(() => void (moved = result.current.move('left')));
    expect(moved).toBe(true);
    expect(result.current.choice).toBe('lower');
  });

  it('has no buttons to move between on the undo pill', () => {
    const { result } = hook({ offer: undo });
    let moved = true;
    act(() => void (moved = result.current.move('right')));
    expect(moved).toBe(false);
  });

  it('OK answers with the focused button: lower, keep or restore', () => {
    const { result, answer, rerender, shown } = hook();
    act(() => result.current.activate());
    expect(answer).toHaveBeenLastCalledWith('lower');
    act(() => void result.current.move('right'));
    act(() => result.current.activate());
    expect(answer).toHaveBeenLastCalledWith('keep');
    rerender({ offer: undo, slotFree: true, paused: false, answer, shown });
    act(() => result.current.activate());
    expect(answer).toHaveBeenLastCalledWith('restore');
  });

  it('Back keeps on the prompt and hides the undo pill', () => {
    const { result, answer, rerender, shown } = hook();
    act(() => result.current.dismiss());
    expect(answer).toHaveBeenLastCalledWith('keep');
    rerender({ offer: undo, slotFree: true, paused: false, answer, shown });
    act(() => result.current.dismiss());
    expect(answer).toHaveBeenLastCalledWith('hide');
  });

  it('the buttons answer for themselves', () => {
    const { result, answer } = hook();
    act(() => result.current.lower());
    expect(answer).toHaveBeenLastCalledWith('lower');
    act(() => result.current.keep());
    expect(answer).toHaveBeenLastCalledWith('keep');
    act(() => result.current.restore());
    expect(answer).toHaveBeenLastCalledWith('restore');
  });
});

describe('useBufferingPill, round 5', () => {
  function hook2(offer: BufferingOffer | null) {
    vi.useFakeTimers();
    const answer = vi.fn();
    const shown = vi.fn();
    const result = renderHook((props) => useBufferingPill(props), {
      initialProps: { offer, slotFree: true, paused: false, answer, shown },
    });
    return { ...result, answer, shown };
  }

  it('a new offer starts with a zero elapsed time, also after a pause froze the old one', () => {
    const { result, rerender, answer, shown } = hook2(prompt);
    act(() => void vi.advanceTimersByTime(5000));
    rerender({ offer: prompt, slotFree: true, paused: true, answer, shown });
    expect(result.current.elapsedMs).toBe(5000);
    rerender({ offer: { kind: 'prompt', id: 2 }, slotFree: true, paused: true, answer, shown });
    expect(result.current.elapsedMs).toBe(0);
  });

  it('a new offer has the first button again: Right moves to the second one at once', () => {
    const { result, rerender, answer, shown } = hook2(prompt);
    act(() => void result.current.move('right'));
    expect(result.current.choice).toBe('keep');
    rerender({ offer: { kind: 'prompt', id: 2 }, slotFree: true, paused: false, answer, shown });
    let moved = false;
    act(() => void (moved = result.current.move('right')));
    expect(moved).toBe(true);
    expect(result.current.choice).toBe('keep');
  });

  it('two moves in one step: the second finds the first one done', () => {
    const { result } = hook2(prompt);
    const moves: boolean[] = [];
    act(() => {
      moves.push(result.current.move('right'));
      moves.push(result.current.move('right'));
    });
    expect(moves).toEqual([true, false]);
  });

  it('with no offer yet the first button is the choice', () => {
    const { result } = hook2(null);
    expect(result.current.choice).toBe('lower');
  });
});
