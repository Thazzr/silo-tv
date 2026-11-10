import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeyValueStore } from '../platform';
import { I18nProvider, useT } from './index';
import {
  getLanguageSetting,
  setLanguageSetting,
  subscribeLanguageSetting,
} from './languageSetting';

const memory = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    get: (key) => data.get(key) ?? null,
    set: (key, value) => void data.set(key, value),
    remove: (key) => void data.delete(key),
  };
};
const throwing: KeyValueStore = {
  get: () => {
    throw new Error('no storage');
  },
  set: () => {
    throw new Error('no storage');
  },
  remove: () => {
    throw new Error('no storage');
  },
};

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('the language setting storage', () => {
  it('is Automatic by default, and keeps what was set, under a key of the settings namespace', () => {
    const store = memory();
    expect(getLanguageSetting(store)).toBe('auto');
    setLanguageSetting('de', store);
    expect(getLanguageSetting(store)).toBe('de');
    expect([...store.data.keys()]).toEqual(['silo-tv.settings.language']);
  });

  it('survives a reload: it is read back from the device storage', () => {
    setLanguageSetting('en');
    expect(window.localStorage.getItem('silo-tv.settings.language')).toBe('en');
    expect(getLanguageSetting()).toBe('en');
  });

  it('is Automatic for an unknown stored value', () => {
    const store = memory();
    store.set('silo-tv.settings.language', 'klingon');
    expect(getLanguageSetting(store)).toBe('auto');
  });

  it('is Automatic when storage throws on a read, and keeps a choice for the session when a write fails', () => {
    expect(getLanguageSetting(throwing)).toBe('auto');
    setLanguageSetting('de', throwing);
    expect(getLanguageSetting(throwing)).toBe('de');
    // A later successful write takes over again.
    setLanguageSetting('auto', memory());
    expect(getLanguageSetting(throwing)).toBe('auto');
  });
});

function Text() {
  const t = useT();
  return <p data-testid="text">{t('settings.title')}</p>;
}

function withNavigatorLanguage(language: string) {
  vi.spyOn(window.navigator, 'language', 'get').mockReturnValue(language);
}

const provided = (lang?: 'de' | 'en') => (
  <I18nProvider lang={lang}>
    <Text />
  </I18nProvider>
);

describe('subscribing to the language setting', () => {
  it('calls the listener on a change, and no longer after it unsubscribed', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLanguageSetting(listener);
    setLanguageSetting('de');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setLanguageSetting('en');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('I18nProvider and the language setting', () => {
  it.each([
    ['de-AT', 'Einstellungen'],
    ['de', 'Einstellungen'],
    ['fr-FR', 'Settings'],
    ['en-US', 'Settings'],
  ])('Automatic follows the TV language %s', (language, text) => {
    withNavigatorLanguage(language);
    render(provided());
    expect(screen.getByTestId('text')).toHaveTextContent(text);
  });

  it('the override wins over the TV language', () => {
    withNavigatorLanguage('de-DE');
    setLanguageSetting('en');
    render(provided());
    expect(screen.getByTestId('text')).toHaveTextContent('Settings');
    cleanup();
    withNavigatorLanguage('fr-FR');
    setLanguageSetting('de');
    render(provided());
    expect(screen.getByTestId('text')).toHaveTextContent('Einstellungen');
  });

  it('switching re-renders a visible text at once, and Automatic returns to the TV language', () => {
    withNavigatorLanguage('de-DE');
    render(provided());
    expect(screen.getByTestId('text')).toHaveTextContent('Einstellungen');
    act(() => setLanguageSetting('en'));
    expect(screen.getByTestId('text')).toHaveTextContent('Settings');
    act(() => setLanguageSetting('auto'));
    expect(screen.getByTestId('text')).toHaveTextContent('Einstellungen');
  });

  it('an explicit lang prop (tests, previews) still wins', () => {
    setLanguageSetting('de');
    render(provided('en'));
    expect(screen.getByTestId('text')).toHaveTextContent('Settings');
  });
});
