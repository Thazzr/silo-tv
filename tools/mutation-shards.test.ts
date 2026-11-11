import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SHARDS,
  EXCLUDE,
  INCLUDE,
  MUTATE,
  assignShards,
  filesOfShard,
  listMutateFiles,
  parseShard,
  withSizes,
} from './mutation-shards.mjs';

const file = (path: string, size: number) => ({ path, size });

describe('parseShard', () => {
  it('reads k/N, 1-based', () => {
    expect(parseShard('3/24')).toEqual({ index: 3, count: 24 });
    expect(parseShard('1/1')).toEqual({ index: 1, count: 1 });
    expect(parseShard('24/24')).toEqual({ index: 24, count: 24 });
  });

  it.each(['0/24', '25/24', '3/0', 'x', '', '3', '3/', '/24', '-1/24', '1.5/24', '3/24/2'])(
    'throws on %j instead of falling back to the whole set',
    (value) => {
      expect(() => parseShard(value)).toThrow(/Invalid shard/);
    },
  );

  it('throws on a missing value', () => {
    expect(() => parseShard(undefined)).toThrow(/Invalid shard/);
  });
});

describe('assignShards', () => {
  const files = [
    file('a.ts', 100),
    file('b.ts', 90),
    file('c.ts', 80),
    file('d.ts', 70),
    file('e.ts', 60),
    file('f.ts', 10),
  ];

  it('packs the largest file first onto the shard with the smallest total', () => {
    const shards = assignShards(files, 3);
    // a->1, b->2, c->3, d->3 (80 is the smallest), e->2 (90 < 100 < 150), f->1 (100 < 150 < 150: tie, lower number)
    expect(shards.map((s) => s.files)).toEqual([
      ['a.ts', 'f.ts'],
      ['b.ts', 'e.ts'],
      ['c.ts', 'd.ts'],
    ]);
    expect(shards.map((s) => s.size)).toEqual([110, 150, 150]);
  });

  it('breaks ties by the lower shard number', () => {
    const shards = assignShards([file('x.ts', 5), file('y.ts', 5)], 3);
    expect(shards.map((s) => s.files)).toEqual([['x.ts'], ['y.ts'], []]);
  });

  it('puts every file into exactly one shard', () => {
    const many = Array.from({ length: 50 }, (_, i) => file(`f${i}.ts`, ((i * 37) % 11) + 1));
    const all = assignShards(many, 7).flatMap((s) => s.files);
    expect([...all].sort()).toEqual(many.map((f) => f.path).sort());
  });

  it('is deterministic: the order of the input does not matter', () => {
    const forward = assignShards(files, 3);
    const backward = assignShards([...files].reverse(), 3);
    expect(backward).toEqual(forward);
  });

  it('orders equal sizes by path', () => {
    const shards = assignShards([file('b.ts', 5), file('a.ts', 5)], 2);
    expect(shards.map((s) => s.files)).toEqual([['a.ts'], ['b.ts']]);
  });
});

describe('filesOfShard', () => {
  it('covers the whole mutate set across all shards without overlap', () => {
    const all = listMutateFiles();
    const shards = Array.from({ length: 24 }, (_, i) => filesOfShard(`${i + 1}/24`));
    expect(shards.flat().sort()).toEqual(all);
    expect(new Set(shards.flat()).size).toBe(all.length);
  });

  it('throws for an empty shard instead of letting Stryker mutate everything', () => {
    const count = listMutateFiles().length + 1;
    expect(() => filesOfShard(`${count}/${count}`)).toThrow(/no files/);
  });

  it('only lists product code', () => {
    const all = listMutateFiles();
    expect(all.length).toBeGreaterThan(100);
    for (const path of all) {
      expect(path).toMatch(/^src\/.*\.tsx?$/);
      expect(path).not.toMatch(/\.test\.tsx?$|\.d\.ts$|^src\/test\/|^src\/api\/generated\//);
    }
    expect(all).not.toContain('src/main.tsx');
  });

  it('sizes the files by their bytes', () => {
    const [first] = withSizes(['package.json']);
    expect(first?.size).toBeGreaterThan(100);
  });
});

describe('the stryker config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadConfig(shard: string | undefined) {
    if (shard === undefined) vi.stubEnv('STRYKER_SHARD', '');
    else vi.stubEnv('STRYKER_SHARD', shard);
    vi.resetModules();
    return (await import('../stryker.config.mjs')).default;
  }

  it('mutates the list of the shard module without STRYKER_SHARD', async () => {
    const config = await loadConfig(undefined);
    expect(config.mutate).toEqual(MUTATE);
    expect(MUTATE).toEqual([...INCLUDE, ...EXCLUDE.map((pattern) => `!${pattern}`)]);
  });

  it('mutates only the files of the shard with STRYKER_SHARD', async () => {
    const config = await loadConfig('2/24');
    expect(config.mutate).toEqual(filesOfShard('2/24'));
  });

  it('throws on a malformed STRYKER_SHARD', async () => {
    await expect(loadConfig('25/24')).rejects.toThrow(/Invalid shard/);
  });

  it('keeps agent worktrees out of the sandbox', async () => {
    const config = await loadConfig(undefined);
    expect(config.ignorePatterns).toContain('.claude');
  });
});

describe('the workflow', () => {
  it('runs as many matrix jobs as SHARDS says, and as the default shard count', () => {
    const yaml = readFileSync('.github/workflows/mutation.yml', 'utf-8');
    const shards = Number(/^ {2}SHARDS: (\d+)/m.exec(yaml)?.[1]);
    const matrix = /shard:\s*\[([^\]]+)\]/.exec(yaml)?.[1]?.split(',').map(Number);
    expect(shards).toBe(DEFAULT_SHARDS);
    expect(matrix).toEqual(Array.from({ length: shards }, (_, i) => i + 1));
  });
});
