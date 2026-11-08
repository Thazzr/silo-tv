import { describe, expect, it } from 'vitest';
import de from './de.json';
import en from './en.json';
import { detectLanguage, translate, translateWith, type MessageKey } from './translate';

describe('message files', () => {
  it('have exactly the same keys', () => {
    const deKeys = Object.keys(de);
    const enKeys = Object.keys(en);
    const missingInEn = deKeys.filter((k) => !enKeys.includes(k));
    const missingInDe = enKeys.filter((k) => !deKeys.includes(k));
    expect(
      { missingInEn, missingInDe },
      `Missing keys - en.json: [${missingInEn.join(', ')}], de.json: [${missingInDe.join(', ')}]`,
    ).toEqual({ missingInEn: [], missingInDe: [] });
  });
});

describe('detectLanguage', () => {
  it.each([
    ['de', 'de'],
    ['de-DE', 'de'],
    ['de-AT', 'de'],
    ['en-US', 'en'],
    ['de_DE', 'de'],
    ['DE-at', 'de'],
    ['  de-DE ', 'de'],
    ['en_GB', 'en'],
    ['fr', 'en'],
    ['', 'en'],
  ])('maps %j to %s', (tag, expected) => {
    expect(detectLanguage(tag)).toBe(expected);
  });
});

describe('translate', () => {
  it('returns the text of the requested language', () => {
    expect(translate('de', 'platform.title')).toBe('Plattform');
    expect(translate('en', 'platform.title')).toBe('Platform');
  });

  it('interpolates {name} parameters', () => {
    expect(translate('en', 'platform.keyEntry', { key: 'Enter', code: 13, mapped: 'enter' })).toBe(
      'Enter (code 13) → enter',
    );
  });

  it('leaves unknown placeholders untouched', () => {
    expect(translate('en', 'platform.keyEntry', { key: 'x' })).toContain('{code}');
  });

  it('falls back to the key when no language has the message', () => {
    expect(translate('de', 'does.not.exist' as MessageKey)).toBe('does.not.exist');
    expect(translate('en', 'does.not.exist' as MessageKey)).toBe('does.not.exist');
  });

  it('falls back to en when de lacks the key, and to de when en lacks it', () => {
    const partial = { de: {}, en: { onlyEn: 'only en' } };
    expect(translateWith(partial, 'de', 'onlyEn')).toBe('only en');
    const partial2 = { de: { onlyDe: 'nur de' }, en: {} };
    expect(translateWith(partial2, 'en', 'onlyDe')).toBe('nur de');
  });
});
