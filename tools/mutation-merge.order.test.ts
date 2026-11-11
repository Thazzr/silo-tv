import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

// A directory listing in reverse order: the file systems of CI and of a developer machine do not
// agree on the order, so the merge has to sort the entries itself.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readdirSync: ((...args: Parameters<typeof actual.readdirSync>) =>
      [
        ...(actual.readdirSync(...args) as unknown as string[]),
      ].reverse()) as unknown as typeof actual.readdirSync,
  };
});

const { expandInputs } = await import('./mutation-merge.mjs');

const dir = mkdtempSync(join(tmpdir(), 'mutation-order-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('expandInputs', () => {
  it('sorts the entries of a directory, whatever order the file system lists them in', () => {
    for (const name of ['b', 'a', 'c']) {
      mkdirSync(join(dir, name));
      writeFileSync(join(dir, name, 'mutation.json'), '{}');
    }
    expect(expandInputs([dir]).map((path) => path.slice(dir.length + 1))).toEqual([
      join('a', 'mutation.json'),
      join('b', 'mutation.json'),
      join('c', 'mutation.json'),
    ]);
  });
});
