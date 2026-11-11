// Language names for track lists. Chromium 79 (webOS 6) has no Intl.DisplayNames, so the common
// languages are a table here, in German and English. Codes come from files and servers in every
// shape: ISO 639-1 (`de`), both ISO 639-2 forms (`ger`/`deu`) and region tags (`pt-BR`).
import type { Language } from './translate';

/** [ISO 639-1, ISO 639-2 codes, German, English]. */
const LANGUAGES: readonly (readonly [string, readonly string[], string, string])[] = [
  ['ar', ['ara'], 'Arabisch', 'Arabic'],
  ['bg', ['bul'], 'Bulgarisch', 'Bulgarian'],
  ['ca', ['cat'], 'Katalanisch', 'Catalan'],
  ['cs', ['cze', 'ces'], 'Tschechisch', 'Czech'],
  ['da', ['dan'], 'Dänisch', 'Danish'],
  ['de', ['ger', 'deu'], 'Deutsch', 'German'],
  ['el', ['gre', 'ell'], 'Griechisch', 'Greek'],
  ['en', ['eng'], 'Englisch', 'English'],
  ['es', ['spa'], 'Spanisch', 'Spanish'],
  ['et', ['est'], 'Estnisch', 'Estonian'],
  ['fa', ['per', 'fas'], 'Persisch', 'Persian'],
  ['fi', ['fin'], 'Finnisch', 'Finnish'],
  ['fr', ['fre', 'fra'], 'Französisch', 'French'],
  ['he', ['heb'], 'Hebräisch', 'Hebrew'],
  ['hi', ['hin'], 'Hindi', 'Hindi'],
  ['hr', ['hrv'], 'Kroatisch', 'Croatian'],
  ['hu', ['hun'], 'Ungarisch', 'Hungarian'],
  ['id', ['ind'], 'Indonesisch', 'Indonesian'],
  ['is', ['ice', 'isl'], 'Isländisch', 'Icelandic'],
  ['it', ['ita'], 'Italienisch', 'Italian'],
  ['ja', ['jpn'], 'Japanisch', 'Japanese'],
  ['ko', ['kor'], 'Koreanisch', 'Korean'],
  ['lt', ['lit'], 'Litauisch', 'Lithuanian'],
  ['lv', ['lav'], 'Lettisch', 'Latvian'],
  ['nl', ['dut', 'nld'], 'Niederländisch', 'Dutch'],
  ['no', ['nor', 'nob', 'nno', 'nb', 'nn'], 'Norwegisch', 'Norwegian'],
  ['pl', ['pol'], 'Polnisch', 'Polish'],
  ['pt', ['por'], 'Portugiesisch', 'Portuguese'],
  ['ro', ['rum', 'ron'], 'Rumänisch', 'Romanian'],
  ['ru', ['rus'], 'Russisch', 'Russian'],
  ['sk', ['slo', 'slk'], 'Slowakisch', 'Slovak'],
  ['sl', ['slv'], 'Slowenisch', 'Slovenian'],
  ['sr', ['srp'], 'Serbisch', 'Serbian'],
  ['sv', ['swe'], 'Schwedisch', 'Swedish'],
  ['th', ['tha'], 'Thailändisch', 'Thai'],
  ['tr', ['tur'], 'Türkisch', 'Turkish'],
  ['uk', ['ukr'], 'Ukrainisch', 'Ukrainian'],
  ['vi', ['vie'], 'Vietnamesisch', 'Vietnamese'],
  ['zh', ['chi', 'zho', 'cmn', 'yue'], 'Chinesisch', 'Chinese'],
];

/** [region, German, English]. */
const REGIONS: readonly (readonly [string, string, string])[] = [
  ['AR', 'Argentinien', 'Argentina'],
  ['AT', 'Österreich', 'Austria'],
  ['AU', 'Australien', 'Australia'],
  ['BE', 'Belgien', 'Belgium'],
  ['BR', 'Brasilien', 'Brazil'],
  ['CA', 'Kanada', 'Canada'],
  ['CH', 'Schweiz', 'Switzerland'],
  ['CN', 'China', 'China'],
  ['DE', 'Deutschland', 'Germany'],
  ['ES', 'Spanien', 'Spain'],
  ['FR', 'Frankreich', 'France'],
  ['GB', 'Vereinigtes Königreich', 'United Kingdom'],
  ['HK', 'Hongkong', 'Hong Kong'],
  ['IE', 'Irland', 'Ireland'],
  ['IN', 'Indien', 'India'],
  ['IT', 'Italien', 'Italy'],
  ['JP', 'Japan', 'Japan'],
  ['MX', 'Mexiko', 'Mexico'],
  ['NL', 'Niederlande', 'Netherlands'],
  ['PT', 'Portugal', 'Portugal'],
  ['TW', 'Taiwan', 'Taiwan'],
  ['US', 'USA', 'United States'],
];

/** Written-form subtags that tell Chinese apart. */
const SCRIPTS: Record<string, readonly [string, string]> = {
  hans: ['vereinfacht', 'Simplified'],
  hant: ['traditionell', 'Traditional'],
};

const byCode = new Map<string, readonly [string, string]>();
const twoLetter = new Map<string, string>();
for (const [two, three, de, en] of LANGUAGES) {
  byCode.set(two, [de, en]);
  for (const code of three) {
    byCode.set(code, [de, en]);
    twoLetter.set(code, two);
  }
}
const byRegion = new Map(REGIONS.map(([code, de, en]) => [code, [de, en] as const]));

const pick = (pair: readonly [string, string], lang: Language): string =>
  lang === 'de' ? pair[0] : pair[1];

/** Whether `word` is a language's code or name (`GER`, `de`, `Deutsch`, `German`). */
export function isLanguageWord(word: string): boolean {
  const lower = word.trim().toLowerCase();
  if (!lower) return false;
  if (byCode.has(lower)) return true;
  return LANGUAGES.some(([, , de, en]) => de.toLowerCase() === lower || en.toLowerCase() === lower);
}

/**
 * The name of a track's language in the app's language: "Deutsch", "Portugiesisch (Brasilien)".
 * An undetermined (`und`), empty or unknown code gives `title` (the track's own title) when the
 * caller has one, else the code in capitals; null only when there is neither.
 */
export function languageName(
  code: string | null | undefined,
  lang: Language,
  title?: string | null,
): string | null {
  const fallback = title?.trim() ? title.trim() : null;
  const raw = code?.trim();
  if (!raw) return fallback;
  const [primary = '', ...rest] = raw.toLowerCase().replace(/_/g, '-').split('-');
  const base = byCode.get(primary);
  if (!base) return fallback ?? raw.toUpperCase();
  const name = pick(base, lang);
  // The first subtag after the language that is a script or a region says which variant it is.
  let variant: string | null = null;
  for (const part of rest) {
    const script = SCRIPTS[part];
    const region = byRegion.get(part.toUpperCase());
    if (script) variant = pick(script, lang);
    else if (region) variant = pick(region, lang);
    if (variant) break;
  }
  return variant ? `${name} (${variant})` : name;
}

/**
 * A language tag in the form two tags are compared in: lower case, `_` as `-`, and the language
 * subtag as its ISO 639-1 code where there is one (`eng` and `en` are one language, `pt_BR` is
 * `pt-br`). Null for anything that does not start with a language code of two or three letters.
 * Chromium 79 has no dependable `Intl.Locale` aliasing, so the table above does it.
 */
export function canonicalLanguageTag(tag: string): string | null {
  const [language = '', ...rest] = tag.trim().toLowerCase().replace(/_/g, '-').split('-');
  if (!/^[a-z]{2,3}$/.test(language)) return null;
  return [twoLetter.get(language) ?? language, ...rest].join('-');
}
