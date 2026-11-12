import { useCallback } from 'react';
import de from './de.json';
import { useLanguage, useT } from './index';
import type { Language, MessageKey, Params } from './translate';

/** What a Home or library section carries for its title: the server's text and, for its own rows, a key. */
export interface SectionTitleSource {
  title: string;
  title_key?: string;
  title_args?: Record<string, string>;
}

const SERVER_KEY_PREFIX = 'home.section.';
const CATALOGUE_PREFIX = 'section.title.';

/**
 * A section's title for display, the way Silo's web app shows it. A translated interface shows
 * the catalogue's text for the section's `title_key`, filled from `title_args`; an unknown key, a
 * missing argument or no key shows the server's `title`. English shows `title` as sent, because
 * the server's own titles are the English text of the keys.
 */
export function sectionTitle(
  section: SectionTitleSource,
  language: Language,
  t: (key: MessageKey, params?: Params) => string,
): string {
  const serverKey = section.title_key;
  if (language === 'en' || !serverKey?.startsWith(SERVER_KEY_PREFIX)) return section.title;
  const key = CATALOGUE_PREFIX + serverKey.slice(SERVER_KEY_PREFIX.length);
  if (!(key in de)) return section.title;
  const args = section.title_args ?? {};
  const placeholders = de[key as MessageKey].match(/\{\w+\}/g) ?? [];
  if (placeholders.some((placeholder) => !(placeholder.slice(1, -1) in args))) return section.title;
  return t(key as MessageKey, args);
}

/** `sectionTitle` in the viewer's language; the function only changes when the language does. */
export function useSectionTitle(): (section: SectionTitleSource) => string {
  const language = useLanguage();
  const t = useT();
  return useCallback((section) => sectionTitle(section, language, t), [language, t]);
}
