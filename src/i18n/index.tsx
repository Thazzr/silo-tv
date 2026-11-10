import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { getLanguageSetting, subscribeLanguageSetting } from './languageSetting';
import { detectLanguage, translate, type Language, type MessageKey } from './translate';

export { detectLanguage, translate };
export type { Language, MessageKey };

type TFunction = (key: MessageKey, params?: Record<string, string | number>) => string;

const I18nContext = createContext<Language>('de');

export function I18nProvider({ children, lang }: { children: ReactNode; lang?: Language }) {
  // The viewer's own choice (Settings) wins over the TV's language; `lang` is for tests and previews.
  const setting = useSyncExternalStore(subscribeLanguageSetting, getLanguageSetting);
  const value = useMemo(
    () => lang ?? (setting === 'auto' ? detectLanguage(navigator.language) : setting),
    [lang, setting],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** The language the app is shown in (for formatting dates and numbers the way the text reads). */
export function useLanguage(): Language {
  return useContext(I18nContext);
}

export function useT(): TFunction {
  const lang = useContext(I18nContext);
  return useCallback((key, params) => translate(lang, key, params), [lang]);
}
