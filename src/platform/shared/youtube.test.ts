import { describe, expect, it } from 'vitest';
import { isValidYouTubeVideoId } from './youtube';

describe('isValidYouTubeVideoId', () => {
  it('accepts plain ids of 6 to 20 characters', () => {
    for (const id of ['dQw4w9WgXcQ', 'abc-_9', 'A'.repeat(20), '-_-_-_']) {
      expect(isValidYouTubeVideoId(id)).toBe(true);
    }
  });

  it('rejects anything else', () => {
    for (const id of ['', 'abcde', 'A'.repeat(21), 'abc def', 'abc?v=1', 'ab/cdefg', 'ünïcode12']) {
      expect(isValidYouTubeVideoId(id)).toBe(false);
    }
    expect(isValidYouTubeVideoId(undefined)).toBe(false);
    expect(isValidYouTubeVideoId(12345678)).toBe(false);
  });
});
