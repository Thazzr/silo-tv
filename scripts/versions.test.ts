import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Vitest runs from the repo root; jsdom replaces URL, so no import.meta.url file URLs here.
const read = (path: string) =>
  JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf-8')) as Record<string, unknown>;

describe('package metadata', () => {
  it('keeps appinfo.json and package.json on the same version', () => {
    expect(read('public/appinfo.json').version).toBe(read('package.json').version);
  });

  it('uses the app id io.github.thazzr.silotv', () => {
    expect(read('public/appinfo.json').id).toBe('io.github.thazzr.silotv');
  });
});
