import { describe, expect, it } from 'vitest';
import { translate, type MessageKey } from '../../i18n';
import {
  EXTRAS_LIMIT,
  extraCaption,
  extraEntries,
  extraKindLabel,
  extraRuntime,
  localExtras,
  youtubeVideos,
  type ItemExtra,
  type ItemVideo,
} from './extras';

const en = (key: MessageKey, params?: Record<string, string | number>) =>
  translate('en', key, params);
const de = (key: MessageKey, params?: Record<string, string | number>) =>
  translate('de', key, params);

const extra = (id: string, overrides: Partial<ItemExtra> = {}): ItemExtra => ({
  content_id: `local-${id}`,
  kind: 'trailer',
  ...overrides,
});
const video = (key: string, overrides: Partial<ItemVideo> = {}): ItemVideo => ({
  is_official: false,
  kind: 'trailer',
  site: 'youtube',
  site_key: key,
  ...overrides,
});

describe('extraKindLabel', () => {
  it('names every kind the server knows, in English and German', () => {
    const kinds = {
      trailer: ['Trailer', 'Trailer'],
      teaser: ['Teaser', 'Teaser'],
      featurette: ['Featurette', 'Featurette'],
      clip: ['Clip', 'Clip'],
      behind_the_scenes: ['Behind the Scenes', 'Hinter den Kulissen'],
      bloopers: ['Bloopers', 'Outtakes'],
      deleted_scene: ['Deleted Scene', 'Entfallene Szene'],
      other: ['Extra', 'Extra'],
    };
    for (const [kind, [english, german]] of Object.entries(kinds)) {
      expect(extraKindLabel(kind, en)).toBe(english);
      expect(extraKindLabel(kind, de)).toBe(german);
    }
  });

  it('reads a kind it does not know (a newer server) as Extra, also an inherited property name', () => {
    expect(extraKindLabel('making_of', en)).toBe('Extra');
    expect(extraKindLabel('', de)).toBe('Extra');
    expect(extraKindLabel('constructor', en)).toBe('Extra');
  });
});

describe('extraCaption', () => {
  it('prefers the title and falls back to the kind label for a missing or blank one', () => {
    expect(extraCaption('Making of', 'featurette', en)).toBe('Making of');
    expect(extraCaption(undefined, 'featurette', en)).toBe('Featurette');
    expect(extraCaption('   ', 'bloopers', de)).toBe('Outtakes');
  });
});

describe('extraRuntime', () => {
  it('writes m:ss and h:mm:ss, and nothing without a duration', () => {
    expect(extraRuntime(125)).toBe('2:05');
    expect(extraRuntime(3723)).toBe('1:02:03');
    expect(extraRuntime(undefined)).toBe('');
    expect(extraRuntime(0)).toBe('');
  });
});

describe('localExtras', () => {
  it('keeps the server order and stops at the limit', () => {
    const many = Array.from({ length: EXTRAS_LIMIT + 5 }, (_, i) => extra(String(i)));
    const shown = localExtras({ extras: many });
    expect(shown).toHaveLength(24);
    expect(shown.map((e) => e.content_id)).toEqual(many.slice(0, 24).map((e) => e.content_id));
  });

  it('is empty without extras', () => {
    expect(localExtras({})).toEqual([]);
  });
});

describe('youtubeVideos', () => {
  it('keeps only YouTube, in the server order, and drops a key that is no plain id', () => {
    const shown = youtubeVideos({
      videos: [
        video('abcdefghijk'),
        video('vimeo-id-123', { site: 'Vimeo' }),
        video('bad id/../x'),
        video('ZYXWVUTSRQP', { site: 'YouTube' }),
      ],
    });
    expect(shown.map((v) => v.site_key)).toEqual(['abcdefghijk', 'ZYXWVUTSRQP']);
  });

  it('stops at the limit', () => {
    const many = Array.from({ length: 30 }, (_, i) => video(`video-${String(i).padStart(3, '0')}`));
    expect(youtubeVideos({ videos: many })).toHaveLength(24);
  });
});

describe('extraEntries', () => {
  it('puts the local extras first, then the YouTube videos', () => {
    const entries = extraEntries({
      extras: [extra('a'), extra('b')],
      videos: [video('abcdefghijk')],
    });
    expect(entries.map((e) => e.key)).toEqual([
      'local:local-a',
      'local:local-b',
      'youtube:abcdefghijk',
    ]);
    expect(entries[2]).toMatchObject({ type: 'youtube', videoId: 'abcdefghijk' });
  });

  it('is empty when there is nothing to show', () => {
    expect(extraEntries({})).toEqual([]);
    expect(extraEntries({ videos: [video('vimeo-id-123', { site: 'vimeo' })] })).toEqual([]);
  });
});
