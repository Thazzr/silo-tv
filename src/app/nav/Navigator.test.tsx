import { StrictMode, useEffect, useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n';
import { KEY, pressKey } from '../../test/keys';
import { Focusable, Navigator, useBackHandler, useNavigator, type NavApi } from '.';

type TestScreen = { name: 'home' } | { name: 'list' } | { name: 'detail'; id: string };

// The navigator of the current test, as seen from inside the tree.
const holder: { current: NavApi<TestScreen> | null } = { current: null };
const nav = () => holder.current!;
function Capture() {
  const api = useNavigator<TestScreen>();
  useEffect(() => {
    holder.current = api;
  });
  return null;
}

function Buttons({ prefix, count }: { prefix: string; count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <Focusable key={i} focusKey={`${prefix}-${i}`} autoFocus={i === 0}>
          {`${prefix} ${i}`}
        </Focusable>
      ))}
    </>
  );
}

function Detail({ id, onBack }: { id: string; onBack?: () => void }) {
  useBackHandler(onBack);
  return (
    <main data-testid="detail">
      detail {id}
      <Buttons prefix="detail" count={2} />
    </main>
  );
}

function setup(detailBack?: () => void) {
  render(
    <I18nProvider lang="en">
      <Navigator<TestScreen>
        initial={{ name: 'home' }}
        renderScreen={(screen) => {
          switch (screen.name) {
            case 'home':
              return (
                <main data-testid="home">
                  <Buttons prefix="home" count={4} />
                </main>
              );
            case 'list':
              return (
                <main data-testid="list">
                  <Buttons prefix="list" count={3} />
                </main>
              );
            case 'detail':
              return <Detail id={screen.id} onBack={detailBack} />;
          }
        }}
      >
        <Capture />
      </Navigator>
    </I18nProvider>,
  );
}

const shown = () =>
  ['home', 'list', 'detail'].filter((id) => screen.queryByTestId(id) !== null) as string[];

describe('Navigator stack', () => {
  it('shows only the top screen: push opens one over the other and pop returns', () => {
    setup();
    expect(shown()).toEqual(['home']);
    expect(nav().depth).toBe(1);
    act(() => nav().push({ name: 'list' }));
    expect(shown()).toEqual(['list']);
    expect(nav().depth).toBe(2);
    act(() => nav().push({ name: 'detail', id: '7' }));
    expect(screen.getByTestId('detail')).toHaveTextContent('detail 7');
    expect(nav().depth).toBe(3);
    act(() => nav().pop());
    expect(shown()).toEqual(['list']);
    act(() => nav().pop());
    expect(shown()).toEqual(['home']);
  });

  it('pop on the root entry does nothing', () => {
    setup();
    act(() => nav().pop());
    expect(shown()).toEqual(['home']);
    expect(nav().depth).toBe(1);
  });

  it('replace swaps the top screen and keeps the ones below', () => {
    setup();
    act(() => nav().push({ name: 'list' }));
    act(() => nav().replace({ name: 'detail', id: '1' }));
    expect(shown()).toEqual(['detail']);
    expect(nav().depth).toBe(2);
    act(() => nav().pop());
    expect(shown()).toEqual(['home']);
  });

  it('reset drops the whole stack', () => {
    setup();
    act(() => nav().push({ name: 'list' }));
    act(() => nav().push({ name: 'detail', id: '1' }));
    act(() => nav().reset({ name: 'list' }));
    expect(shown()).toEqual(['list']);
    expect(nav().depth).toBe(1);
    act(() => nav().pop());
    expect(shown()).toEqual(['list']);
  });

  it('stacks operations called in the same tick', () => {
    setup();
    act(() => {
      nav().push({ name: 'list' });
      nav().push({ name: 'detail', id: '2' });
    });
    expect(nav().depth).toBe(3);
    expect(shown()).toEqual(['detail']);
  });
});

describe('Navigator focus memory', () => {
  it('gives the focus back to the element the user came from, level by level', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('home 0')).toHaveFocus());
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    expect(screen.getByText('home 2')).toHaveFocus();

    act(() => nav().push({ name: 'list' }));
    await waitFor(() => expect(screen.getByText('list 0')).toHaveFocus());
    await pressKey(KEY.down);
    expect(screen.getByText('list 1')).toHaveFocus();

    act(() => nav().push({ name: 'detail', id: '1' }));
    await waitFor(() => expect(screen.getByText('detail 0')).toHaveFocus());

    fireEvent.keyDown(window, { keyCode: KEY.back });
    await waitFor(() => expect(screen.getByText('list 1')).toHaveFocus());
    fireEvent.keyDown(window, { keyCode: KEY.back });
    await waitFor(() => expect(screen.getByText('home 2')).toHaveFocus());
  });

  it('restores the element even when it appears after the screen mounted (late data)', async () => {
    function Late() {
      const [ready, setReady] = useState(false);
      useEffect(() => {
        const timer = setTimeout(() => setReady(true), 30);
        return () => clearTimeout(timer);
      }, []);
      return (
        <main data-testid="home">
          <Focusable focusKey="static" autoFocus>
            static
          </Focusable>
          {ready ? (
            <>
              <Focusable focusKey="late-0">late 0</Focusable>
              <Focusable focusKey="late-1">late 1</Focusable>
            </>
          ) : null}
        </main>
      );
    }
    render(
      <I18nProvider lang="en">
        <Navigator<TestScreen>
          initial={{ name: 'home' }}
          renderScreen={(s) => (s.name === 'home' ? <Late /> : <main data-testid="list" />)}
        >
          <Capture />
        </Navigator>
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByText('static')).toHaveFocus());
    await screen.findByText('late 1');
    await pressKey(KEY.down);
    await waitFor(() => expect(screen.getByText('late 0')).toHaveFocus());
    await pressKey(KEY.down);
    await waitFor(() => expect(screen.getByText('late 1')).toHaveFocus());
    act(() => nav().push({ name: 'list' }));
    act(() => nav().pop());
    // The static element mounts first and takes the focus; the remembered one wins once it is there.
    await waitFor(() => expect(screen.getByText('late 1')).toHaveFocus());
  });

  it.each([false, true])(
    'never moves the focus to the autofocus element when the remembered one mounts in the same commit (StrictMode %s)',
    async (strict) => {
      // Two focus moves racing (the autofocus one first, the restore after it) can finish in either
      // order; only one may be started, so the autofocus element never holds the focus at all.
      const app = (
        <I18nProvider lang="en">
          <Navigator<TestScreen>
            initial={{ name: 'home' }}
            renderScreen={(s) =>
              s.name === 'home' ? (
                <main data-testid="home">
                  <Focusable focusKey="first" autoFocus>
                    first
                  </Focusable>
                  <Focusable focusKey="second">second</Focusable>
                  <Focusable focusKey="third">third</Focusable>
                </main>
              ) : (
                <main data-testid="list" />
              )
            }
          >
            <Capture />
          </Navigator>
        </I18nProvider>
      );
      render(strict ? <StrictMode>{app}</StrictMode> : app);
      await waitFor(() => expect(screen.getByText('first')).toHaveFocus());
      await pressKey(KEY.down);
      await pressKey(KEY.down);
      expect(screen.getByText('third')).toHaveFocus();
      act(() => nav().push({ name: 'list' }));
      const focused: (string | null)[] = [];
      const onFocusIn = (e: FocusEvent) =>
        focused.push((e.target as HTMLElement).getAttribute('data-focus-key'));
      document.addEventListener('focusin', onFocusIn);
      act(() => nav().pop());
      await waitFor(() => expect(screen.getByText('third')).toHaveFocus());
      await act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
      document.removeEventListener('focusin', onFocusIn);
      expect(screen.getByText('third')).toHaveFocus();
      expect(focused).not.toContain('first');
    },
  );
});

describe('Navigator Back', () => {
  it('pops a non-root screen', () => {
    setup();
    act(() => nav().push({ name: 'list' }));
    fireEvent.keyDown(window, { keyCode: KEY.back });
    expect(shown()).toEqual(['home']);
    expect(screen.queryByTestId('exit-dialog')).not.toBeInTheDocument();
  });

  it.each([461, 27])('treats keyCode %i as Back', (keyCode) => {
    setup();
    act(() => nav().push({ name: 'list' }));
    fireEvent.keyDown(window, { keyCode });
    expect(shown()).toEqual(['home']);
  });

  it('opens the exit popup on the root screen instead of popping', () => {
    setup();
    fireEvent.keyDown(window, { keyCode: KEY.back });
    expect(screen.getByTestId('exit-dialog')).toBeInTheDocument();
    // The root screen stays underneath.
    expect(shown()).toEqual(['home']);
  });

  it('lets a screen take over Back; the stack is untouched', () => {
    const onBack = vi.fn();
    setup(onBack);
    act(() => nav().push({ name: 'detail', id: '1' }));
    fireEvent.keyDown(window, { keyCode: KEY.back });
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(shown()).toEqual(['detail']);
    expect(nav().depth).toBe(2);
  });

  it('goes back to the default Back once the screen with a handler is gone', () => {
    const onBack = vi.fn();
    setup(onBack);
    act(() => nav().push({ name: 'detail', id: '1' }));
    act(() => nav().pop());
    fireEvent.keyDown(window, { keyCode: KEY.back });
    expect(onBack).not.toHaveBeenCalled();
    expect(screen.getByTestId('exit-dialog')).toBeInTheDocument();
  });

  it('askExit opens the exit popup for a screen that handles Back itself', () => {
    setup(() => undefined);
    expect(screen.queryByTestId('exit-dialog')).not.toBeInTheDocument();
    act(() => nav().askExit());
    expect(screen.getByTestId('exit-dialog')).toBeInTheDocument();
    // Back closes it again.
    fireEvent.keyDown(window, { keyCode: KEY.back });
    expect(screen.queryByTestId('exit-dialog')).not.toBeInTheDocument();
  });

  it('prevents the default action of Back', () => {
    setup();
    const event = new KeyboardEvent('keydown', { keyCode: KEY.back, cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('lets Backspace edit a text field instead of going back', () => {
    render(
      <I18nProvider lang="en">
        <Navigator initial="a" renderScreen={() => <input aria-label="field" />} />
      </I18nProvider>,
    );
    fireEvent.keyDown(screen.getByLabelText('field'), { keyCode: 8 });
    expect(screen.queryByTestId('exit-dialog')).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { keyCode: 8 });
    expect(screen.getByTestId('exit-dialog')).toBeInTheDocument();
  });
});
