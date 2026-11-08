import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider, type Language } from '../../i18n';
import { getPlatform } from '../../platform';
import { KEY, pressKey } from '../../test/keys';
import { ExitDialog, Focusable, Navigator } from '.';

let exitApp: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  exitApp = vi.spyOn(getPlatform(), 'exitApp').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

function setup(lang: Language = 'en') {
  render(
    <I18nProvider lang={lang}>
      <Navigator
        initial="home"
        renderScreen={() => (
          <main>
            <Focusable focusKey="home-0" autoFocus>
              first
            </Focusable>
            <Focusable focusKey="home-1">second</Focusable>
            <Focusable focusKey="home-2">third</Focusable>
          </main>
        )}
      />
    </I18nProvider>,
  );
}

/** Moves the focus to "second" and opens the popup with Back. */
async function openFromSecond() {
  await waitFor(() => expect(screen.getByText('first')).toHaveFocus());
  await pressKey(KEY.down);
  expect(screen.getByText('second')).toHaveFocus();
  fireEvent.keyDown(window, { keyCode: KEY.back });
  await screen.findByTestId('exit-dialog');
}

describe('ExitDialog', () => {
  it('asks "Exit the app?" with Cancel focused first', async () => {
    setup();
    await openFromSecond();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Exit the app?');
    expect(screen.getAllByRole('button').filter((b) => dialog.contains(b))).toHaveLength(2);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
  });

  it('is German for a German TV', async () => {
    setup('de');
    await waitFor(() => expect(screen.getByText('first')).toHaveFocus());
    fireEvent.keyDown(window, { keyCode: KEY.back });
    expect(await screen.findByRole('dialog')).toHaveTextContent('App beenden?');
    expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Beenden' })).toBeInTheDocument();
  });

  it('closes with Back and gives the focus back to the element that had it', async () => {
    setup();
    await openFromSecond();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
    fireEvent.keyDown(window, { keyCode: KEY.back });
    await waitFor(() => expect(screen.queryByTestId('exit-dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('second')).toHaveFocus());
    expect(exitApp).not.toHaveBeenCalled();
  });

  it('closes with Cancel (OK on the focused button) and restores the focus', async () => {
    setup();
    await openFromSecond();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
    await pressKey(KEY.enter);
    await waitFor(() => expect(screen.queryByTestId('exit-dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('second')).toHaveFocus());
    expect(exitApp).not.toHaveBeenCalled();
  });

  it('Exit calls the platform exitApp exactly once', async () => {
    setup();
    await openFromSecond();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
    await pressKey(KEY.down);
    expect(screen.getByRole('button', { name: 'Exit' })).toHaveFocus();
    await pressKey(KEY.enter);
    expect(exitApp).toHaveBeenCalledTimes(1);
  });

  it('where exitApp cannot close the app (browser), Exit closes the popup and restores the focus', async () => {
    setup();
    await openFromSecond();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
    await pressKey(KEY.down);
    await pressKey(KEY.enter);
    expect(exitApp).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId('exit-dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('second')).toHaveFocus());
  });

  it('keeps the focus inside while open, whatever arrow key is pressed', async () => {
    setup();
    await openFromSecond();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
    const dialog = screen.getByRole('dialog');
    for (const key of [
      KEY.up,
      KEY.up,
      KEY.left,
      KEY.right,
      KEY.down,
      KEY.down,
      KEY.down,
      KEY.down,
    ]) {
      await pressKey(key);
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    // The screen below never got the focus.
    for (const name of ['first', 'second', 'third']) {
      expect(screen.getByText(name)).not.toHaveFocus();
    }
  });

  it('keeps the focus inside when focusables outside the dialog sit right above, below, left and right of it', async () => {
    const onPick = vi.fn();
    // The dialog buttons come last in the document, so the fake layout stacks them at y 4000 (Cancel)
    // and y 5000 (Exit), x 0. The screen buttons surround them at distance, one per direction.
    const around: Record<string, string> = {
      above: '0,3000,100,100',
      below: '0,6000,100,100',
      left: '-500,4000,100,100',
      right: '500,4000,100,100',
    };
    // Standalone, with the buttons at the root of the focus tree: inside a Navigator the screen frame
    // is already a boundary, so only here does the dialog's own boundary make the difference.
    render(
      <I18nProvider lang="en">
        {Object.entries(around).map(([name, rect]) => (
          <Focusable
            key={name}
            focusKey={`around-${name}`}
            autoFocus={name === 'above'}
            data-rect={rect}
            onClick={() => onPick(name)}
          >
            {name}
          </Focusable>
        ))}
        <ExitDialog onClose={() => undefined} />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
    const dialog = screen.getByRole('dialog');
    const keys = [KEY.up, KEY.down, KEY.left, KEY.right];
    for (let round = 0; round < 3; round++) {
      for (const key of keys) {
        await pressKey(key);
        expect(dialog).toContainElement(document.activeElement as HTMLElement);
      }
    }
    for (const name of Object.keys(around)) expect(screen.getByText(name)).not.toHaveFocus();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('shields the screen below from the pointer while open', async () => {
    setup();
    await openFromSecond();
    expect(document.querySelector('.screen-frame')).toHaveAttribute('data-blocked', 'true');
    fireEvent.keyDown(window, { keyCode: KEY.back });
    await waitFor(() => expect(screen.queryByTestId('exit-dialog')).not.toBeInTheDocument());
    expect(document.querySelector('.screen-frame')).toHaveAttribute('data-blocked', 'false');
  });

  it('can be opened again after it was closed', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('first')).toHaveFocus());
    for (let i = 0; i < 2; i++) {
      fireEvent.keyDown(window, { keyCode: KEY.back });
      await screen.findByTestId('exit-dialog');
      await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
      fireEvent.keyDown(window, { keyCode: KEY.back });
      await waitFor(() => expect(screen.queryByTestId('exit-dialog')).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByText('first')).toHaveFocus());
    }
  });
});
