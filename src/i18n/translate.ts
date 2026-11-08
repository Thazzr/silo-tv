import de from './de.json';
import en from './en.json';

export type Language = 'de' | 'en';
export type MessageKey = keyof typeof de;
export type MessageTables = Record<Language, Record<string, string>>;
export type Params = Record<string, string | number>;

const tables: MessageTables = { de, en };

export function detectLanguage(tag: string): Language {
  const primary = tag.trim().toLowerCase().split(/[-_]/)[0];
  return primary === 'de' ? 'de' : 'en';
}

// Separate from translate() so the fallback chain can be tested with partial tables.
export function translateWith(
  source: MessageTables,
  lang: Language,
  key: string,
  params?: Params,
): string {
  // Fallback chain: requested language, then de, then en, then the key itself.
  const template = source[lang][key] ?? source.de[key] ?? source.en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export function translate(lang: Language, key: MessageKey, params?: Params): string {
  return translateWith(tables, lang, key, params);
}
