import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoot } from './AppRoot';
import { I18nProvider } from '../i18n';
import { makeReport } from '../test/probeFixture';

const probe = () => Promise.resolve(makeReport());

function renderApp() {
  return render(
    <I18nProvider lang="en">
      <AppRoot launch={{ probe: true }} probe={probe} />
    </I18nProvider>,
  );
}

describe('AppRoot probe mode', () => {
  it('renders the heading and the app version', async () => {
    renderApp();
    expect(screen.getByRole('heading', { level: 1, name: 'Platform' })).toBeInTheDocument();
    expect(await screen.findByText(__APP_VERSION__)).toBeInTheDocument();
  });

  it('lists a Back press (keyCode 461) as a back entry', () => {
    renderApp();
    fireEvent.keyDown(window, { key: 'GoBack', keyCode: 461 });
    const list = screen.getByTestId('key-list');
    expect(within(list).getByText('GoBack (code 461) → back')).toBeInTheDocument();
  });

  it('shows unmapped keys as such', () => {
    renderApp();
    fireEvent.keyDown(window, { key: 'a', keyCode: 65 });
    expect(screen.getByText('a (code 65) → unmapped')).toBeInTheDocument();
  });

  it('keeps only the last 10 key presses', () => {
    renderApp();
    for (let code = 100; code < 112; code++) {
      fireEvent.keyDown(window, { key: `K${code}`, keyCode: code });
    }
    const items = within(screen.getByTestId('key-list')).getAllByRole('listitem');
    expect(items).toHaveLength(10);
    expect(items[0]).toHaveTextContent('K111');
    expect(screen.queryByText(/K100 /)).not.toBeInTheDocument();
    expect(screen.queryByText(/K101 /)).not.toBeInTheDocument();
    expect(screen.getByText(/K102 /)).toBeInTheDocument();
  });
});

describe('AppRoot probe key handling', () => {
  it.each([461, 8])('prevents the default action of Back (keyCode %i)', (keyCode) => {
    renderApp();
    const event = new KeyboardEvent('keydown', { keyCode, cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not prevent the default action of an unmapped key', () => {
    renderApp();
    const event = new KeyboardEvent('keydown', { keyCode: 65, cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('cancels the default action of Enter: the navigation clicks the focused button itself', () => {
    renderApp();
    const event = new KeyboardEvent('keydown', { keyCode: 13, cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('I18nProvider', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['en-US', 'de', 'Plattform'],
    ['de-DE', 'en', 'Platform'],
  ] as const)('prefers the lang prop over navigator.language %s', (navLang, lang, heading) => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue(navLang);
    render(
      <I18nProvider lang={lang}>
        <AppRoot launch={{ probe: true }} probe={probe} />
      </I18nProvider>,
    );
    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
  });

  it('falls back to navigator.language without a lang prop', () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('de-DE');
    render(
      <I18nProvider>
        <AppRoot launch={{ probe: true }} probe={probe} />
      </I18nProvider>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Plattform' })).toBeInTheDocument();
  });
});
