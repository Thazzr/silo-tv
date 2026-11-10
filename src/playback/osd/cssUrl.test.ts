import { describe, expect, it } from 'vitest';
import { cssUrl } from './PreviewCard';

describe('cssUrl', () => {
  it('leaves a URL as it is, the letter n and percent escapes included', () => {
    const url = 'https://cdn.example.test/t/0.jpg?X-Signature=a%2Bb&exp=1&n=1';
    expect(cssUrl(url)).toBe(`url("${url}")`);
  });

  it('encodes a quote, a backslash and a line break, so the token cannot end early', () => {
    expect(cssUrl('a"b\\c\nd\re')).toBe('url("a%22b%5Cc%0Ad%0De")');
  });
});
