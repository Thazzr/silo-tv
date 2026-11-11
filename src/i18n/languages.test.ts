import { describe, expect, it } from 'vitest';
import { canonicalLanguageTag, isLanguageWord, languageName } from './languages';

describe('languageName', () => {
  it.each([
    ['de', 'Deutsch', 'German'],
    ['ger', 'Deutsch', 'German'],
    ['deu', 'Deutsch', 'German'],
    ['en', 'Englisch', 'English'],
    ['eng', 'Englisch', 'English'],
    ['fr', 'Französisch', 'French'],
    ['fre', 'Französisch', 'French'],
    ['fra', 'Französisch', 'French'],
    ['es', 'Spanisch', 'Spanish'],
    ['spa', 'Spanisch', 'Spanish'],
    ['it', 'Italienisch', 'Italian'],
    ['ita', 'Italienisch', 'Italian'],
    ['ja', 'Japanisch', 'Japanese'],
    ['jpn', 'Japanisch', 'Japanese'],
    ['zh', 'Chinesisch', 'Chinese'],
    ['chi', 'Chinesisch', 'Chinese'],
    ['zho', 'Chinesisch', 'Chinese'],
    ['ko', 'Koreanisch', 'Korean'],
    ['kor', 'Koreanisch', 'Korean'],
    ['nl', 'Niederländisch', 'Dutch'],
    ['dut', 'Niederländisch', 'Dutch'],
    ['nld', 'Niederländisch', 'Dutch'],
    ['pl', 'Polnisch', 'Polish'],
    ['pol', 'Polnisch', 'Polish'],
    ['ru', 'Russisch', 'Russian'],
    ['rus', 'Russisch', 'Russian'],
    ['tr', 'Türkisch', 'Turkish'],
    ['tur', 'Türkisch', 'Turkish'],
    ['pt', 'Portugiesisch', 'Portuguese'],
    ['por', 'Portugiesisch', 'Portuguese'],
    ['sv', 'Schwedisch', 'Swedish'],
    ['swe', 'Schwedisch', 'Swedish'],
    ['da', 'Dänisch', 'Danish'],
    ['dan', 'Dänisch', 'Danish'],
    ['no', 'Norwegisch', 'Norwegian'],
    ['nor', 'Norwegisch', 'Norwegian'],
    ['nob', 'Norwegisch', 'Norwegian'],
    ['fi', 'Finnisch', 'Finnish'],
    ['fin', 'Finnisch', 'Finnish'],
    ['cs', 'Tschechisch', 'Czech'],
    ['cze', 'Tschechisch', 'Czech'],
    ['ces', 'Tschechisch', 'Czech'],
    ['hu', 'Ungarisch', 'Hungarian'],
    ['hun', 'Ungarisch', 'Hungarian'],
    ['el', 'Griechisch', 'Greek'],
    ['gre', 'Griechisch', 'Greek'],
    ['ell', 'Griechisch', 'Greek'],
    ['he', 'Hebräisch', 'Hebrew'],
    ['heb', 'Hebräisch', 'Hebrew'],
    ['ar', 'Arabisch', 'Arabic'],
    ['ara', 'Arabisch', 'Arabic'],
    ['hi', 'Hindi', 'Hindi'],
    ['hin', 'Hindi', 'Hindi'],
    ['th', 'Thailändisch', 'Thai'],
    ['tha', 'Thailändisch', 'Thai'],
    ['uk', 'Ukrainisch', 'Ukrainian'],
    ['ukr', 'Ukrainisch', 'Ukrainian'],
    ['ro', 'Rumänisch', 'Romanian'],
    ['rum', 'Rumänisch', 'Romanian'],
    ['ron', 'Rumänisch', 'Romanian'],
  ])('%s is %s in German and %s in English', (code, de, en) => {
    expect(languageName(code, 'de')).toBe(de);
    expect(languageName(code, 'en')).toBe(en);
  });

  it('ignores case and surrounding blanks, and reads an underscore like a hyphen', () => {
    expect(languageName(' DE ', 'de')).toBe('Deutsch');
    expect(languageName('Eng', 'en')).toBe('English');
    expect(languageName('pt_BR', 'en')).toBe('Portuguese (Brazil)');
  });

  it('names the region of a region tag', () => {
    expect(languageName('pt-BR', 'de')).toBe('Portugiesisch (Brasilien)');
    expect(languageName('pt-BR', 'en')).toBe('Portuguese (Brazil)');
    expect(languageName('en-GB', 'de')).toBe('Englisch (Vereinigtes Königreich)');
    expect(languageName('de-AT', 'en')).toBe('German (Austria)');
    expect(languageName('fr-CA', 'de')).toBe('Französisch (Kanada)');
  });

  it('names the script of a Chinese tag, and leaves an unknown region out', () => {
    expect(languageName('zh-Hant', 'de')).toBe('Chinesisch (traditionell)');
    expect(languageName('zh-Hans', 'en')).toBe('Chinese (Simplified)');
    expect(languageName('zh-TW', 'en')).toBe('Chinese (Taiwan)');
    expect(languageName('en-ZZ', 'en')).toBe('English');
  });

  it('gives an unknown code in capitals', () => {
    expect(languageName('xx', 'en')).toBe('XX');
    expect(languageName('tlh', 'de')).toBe('TLH');
  });

  it('gives an undetermined language in capitals, or the track title when there is one', () => {
    expect(languageName('und', 'en')).toBe('UND');
    expect(languageName('und', 'en', 'Commentary')).toBe('Commentary');
    expect(languageName('xx', 'en', ' Director ')).toBe('Director');
  });

  it('gives the title, or null, without a code', () => {
    expect(languageName(undefined, 'en')).toBeNull();
    expect(languageName('', 'en', 'Main')).toBe('Main');
    expect(languageName(null, 'de', '  ')).toBeNull();
  });

  it('prefers the language over the title for a known code', () => {
    expect(languageName('de', 'de', 'Stereo')).toBe('Deutsch');
  });
});

describe('isLanguageWord', () => {
  it('knows codes and names in both languages', () => {
    for (const word of ['GER', 'de', 'deu', 'Deutsch', 'German', 'english', 'Französisch']) {
      expect(isLanguageWord(word), word).toBe(true);
    }
    expect(isLanguageWord('Commentary')).toBe(false);
    expect(isLanguageWord('')).toBe(false);
  });
});

describe('languageName aliases', () => {
  it('reads the two Norwegian standards and Cantonese', () => {
    expect(languageName('nb', 'de')).toBe('Norwegisch');
    expect(languageName('nn', 'en')).toBe('Norwegian');
    expect(languageName('yue', 'de')).toBe('Chinesisch');
    expect(languageName('cmn', 'en')).toBe('Chinese');
  });
});

describe('canonicalLanguageTag', () => {
  it.each([
    ['en', 'en'],
    ['eng', 'en'],
    ['ger', 'de'],
    ['deu', 'de'],
    ['jpn', 'ja'],
    ['pt-BR', 'pt-br'],
    ['pt_BR', 'pt-br'],
    ['por-PT', 'pt-pt'],
    [' EN-gb ', 'en-gb'],
    ['zh-Hant', 'zh-hant'],
    ['tlh', 'tlh'],
  ])('writes %j as %j', (tag, expected) => {
    expect(canonicalLanguageTag(tag)).toBe(expected);
  });

  it.each(['', ' ', 'e', 'english', '12', '-US', 'en us'])('is null for %j', (tag) => {
    expect(canonicalLanguageTag(tag)).toBeNull();
  });
});
