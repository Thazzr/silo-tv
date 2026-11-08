import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { detectLanguage, translate, type Language, type MessageKey } from './translate';

export { detectLanguage, translate };
export type { Language, MessageKey };

type TFunction = (key: MessageKey, params?: Record<string, string | number>) => string;

const I18nContext = createContext<Language>('de');

export function I18nProvider({ children, lang }: { children: ReactNode; lang?: Language }) {
  const value = useMemo(() => lang ?? detectLanguage(navigator.language), [lang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): TFunction {
  const lang = useContext(I18nContext);
  return useCallback((key, params) => translate(lang, key, params), [lang]);
}
