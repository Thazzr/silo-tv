// Gap tests for the mutation tooling, found by counter-mutating tools/mutation-*.mjs and
// stryker.config.mjs: each block pins behaviour the other test files left open.
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXCLUDE, INCLUDE, assignShards, listMutateFiles, parseShard } from './mutation-shards.mjs';
import {
  escapeForScript,
  expandInputs,
  main as mergeMain,
  mergeReports,
  restrictReport,
} from './mutation-merge.mjs';
import { DEFAULT_REPORT, analyze, buildSummary, main as summaryMain } from './mutation-summary.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const BS = String.fromCharCode(92);
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

const mutants = (counts: Record<string, number>) =>
  Object.entries(counts).flatMap(([status, n]) => Array.from({ length: n }, () => ({ status })));

function rawReport(extra: Record<string, unknown> = {}) {
  return {
    schemaVersion: '1.0',
    thresholds: { high: 80, low: 60, break: null },
    projectRoot: '/repo',
    files: {},
    testFiles: {},
    ...extra,
  };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mutation-gaps-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const quiet = () => vi.spyOn(console, 'log').mockImplementation(() => {});
function write(name: string, content: unknown) {
  const path = join(dir, name);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
  return path;
}
const run = (script: string, args: string[]) =>
  spawnSync(process.execPath, [join(ROOT, 'tools', script), ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
  });

describe('assignShards order', () => {
  it('packs by size, not by path, and lists each shard sorted', () => {
    const shards = assignShards(
      [
        { path: 'z.ts', size: 100 },
        { path: 'a.ts', size: 50 },
        { path: 'm.ts', size: 80 },
      ],
      2,
    );
    // Size order: z -> 1, m -> 2, a -> 2 (80 < 100). Path order would give [a] and [m, z].
    expect(shards.map((s) => s.files)).toEqual([['z.ts'], ['a.ts', 'm.ts']]);
    expect(shards.map((s) => s.size)).toEqual([100, 130]);
  });
});

describe('parseShard whitespace', () => {
  it('trims the value', () => {
    expect(parseShard(' 3/24 ')).toEqual({ index: 3, count: 24 });
  });
});

describe('the mutate set', () => {
  it('leaves out wiring, generated code and the ID constants, and keeps tsx', () => {
    const all = listMutateFiles();
    expect(all).not.toContain('src/polyfills.ts');
    expect(all).not.toContain('src/platform/webos/serviceFetch.ts');
    expect(all.some((path) => path.includes('src/api/generated/'))).toBe(false);
    expect(all.some((path) => path.endsWith('.tsx'))).toBe(true);
    expect(INCLUDE.length).toBeGreaterThan(0);
    // Listed on purpose, although the .d.ts rule would catch the generated schema today.
    expect(EXCLUDE).toContain('src/api/generated/**');
  });
});

describe('the stryker config', () => {
  const saved = { ci: process.env.CI, mutation: process.env.SILO_MUTATION };
  afterEach(() => {
    for (const [key, value] of [
      ['CI', saved.ci],
      ['SILO_MUTATION', saved.mutation],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function load() {
    process.env.CI = 'true';
    delete process.env.SILO_MUTATION;
    vi.stubEnv('STRYKER_SHARD', '');
    vi.resetModules();
    return (await import('../stryker.config.mjs')).default;
  }

  it('switches CI off and the src-only test selection on for the runner', async () => {
    await load();
    expect(process.env.CI).toBe('');
    expect(process.env.SILO_MUTATION).toBe('1');
  });

  it('keeps Stryker out of its own reports', async () => {
    const config = await load();
    expect(config.ignorePatterns).toContain('reports');
  });

  it('writes the report where the summary reads it', async () => {
    const config = await load();
    expect(config.jsonReporter?.fileName).toBe(DEFAULT_REPORT);
  });
});

describe('the command line', () => {
  it('mutation-summary exits 1 with a prefixed message for a missing report', () => {
    const result = run('mutation-summary.mjs', ['--report', join(dir, 'missing.json')]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^mutation-summary: /);
  });

  it('mutation-merge exits 1 without --out', () => {
    const result = run('mutation-merge.mjs', []);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^mutation-merge: .*--out/);
  });
});

describe('--expect', () => {
  it.each(['abc', '-1', '1.5'])('rejects %j as not a whole number', (value) => {
    expect(() => mergeMain(['--out', dir, '--expect', value])).toThrow(/whole number/);
  });

  it('accepts exactly as many valid reports as expected', () => {
    quiet();
    const a = write('a.json', rawReport({ files: { 'src/a.ts': { mutants: [] } } }));
    const b = write('b.json', rawReport({ files: { 'src/b.ts': { mutants: [] } } }));
    expect(() =>
      mergeMain(['--out', join(dir, 'out'), '--no-html', '--expect', '2', a, b]),
    ).not.toThrow();
  });

  it('counts a missing path as a failing report', () => {
    const missing = join(dir, 'missing');
    expect(expandInputs([missing])).toEqual([missing]);
    expect(() => mergeMain(['--out', join(dir, 'out'), '--expect', '1', missing])).toThrow(
      /Cannot read/,
    );
  });
});

describe('summary table', () => {
  const report = (files: Record<string, Array<{ status: string }>>) =>
    analyze({
      files: Object.fromEntries(Object.entries(files).map(([p, m]) => [p, { mutants: m }])),
    });

  it('leaves out a file without a valid mutant', () => {
    const text = buildSummary(
      report({
        'src/ignored.ts': mutants({ Ignored: 3 }),
        'src/ok.ts': mutants({ Killed: 1, Survived: 1 }),
      }),
    );
    expect(text).toContain('src/ok.ts');
    expect(text).not.toContain('src/ignored.ts');
  });

  it('ranks equal scores by undetected mutants, most first', () => {
    const text = buildSummary(
      report({
        // Both 50 %. b.ts has two undetected mutants, a.ts one, so b.ts comes first.
        'src/a.ts': mutants({ Killed: 1, Survived: 1 }),
        'src/b.ts': mutants({ Killed: 2, Survived: 1, NoCoverage: 1 }),
      }),
    );
    expect(text.indexOf('src/b.ts')).toBeGreaterThan(-1);
    expect(text.indexOf('src/b.ts')).toBeLessThan(text.indexOf('src/a.ts'));
  });

  it('prints the exact total row and file row, one number per column', () => {
    const text = buildSummary(
      report({
        'src/f.ts': mutants({ Killed: 3, Survived: 2, Timeout: 1, NoCoverage: 4, CompileError: 5 }),
      }),
    );
    expect(text).toContain('| 3 | 2 | 1 | 4 | 5 |');
    expect(text).toContain('| `src/f.ts` | 40.0 % | 2 | 4 |');
  });

  it('appends to an existing step summary instead of replacing it', () => {
    const report = write(
      'r.json',
      rawReport({ files: { 'src/a.ts': { mutants: mutants({ Killed: 1 }) } } }),
    );
    const summary = write('summary.md', 'earlier step\n');
    summaryMain(['--report', report], { GITHUB_STEP_SUMMARY: summary });
    const text = readFileSync(summary, 'utf-8');
    expect(text.startsWith('earlier step\n')).toBe(true);
    expect(text).toContain('# Mutation testing');
    // A second call keeps appending.
    appendFileSync(summary, '');
    summaryMain(['--report', report], { GITHUB_STEP_SUMMARY: summary });
    expect(readFileSync(summary, 'utf-8').match(/# Mutation testing/g)).toHaveLength(2);
  });
});

describe('the merge', () => {
  it('escapes the JavaScript line separators', () => {
    const escaped = escapeForScript(JSON.stringify({ s: `a${LS}b${PS}c` }));
    expect(escaped).not.toContain(LS);
    expect(escaped).not.toContain(PS);
    expect(escaped).toContain(`${BS}u2028`);
    expect(escaped).toContain(`${BS}u2029`);
  });

  it('takes schemaVersion and thresholds from the first report', () => {
    const merged = mergeReports([
      rawReport(),
      rawReport({ schemaVersion: '2.0', thresholds: { high: 1, low: 2, break: 3 } }),
    ]) as { schemaVersion: string; thresholds: unknown };
    expect(merged.schemaVersion).toBe('1.0');
    expect(merged.thresholds).toEqual({ high: 80, low: 60, break: null });
  });

  it('says so when there is nothing to merge', () => {
    expect(() => mergeReports([])).toThrow(/No reports/);
  });

  it('reads the files of a directory in sorted order', () => {
    // b/ is created first, so creation order and sorted order differ.
    write('in/b/mutation.json', '{}');
    write('in/a/mutation.json', '{}');
    expect(expandInputs([join(dir, 'in')])).toEqual([
      join(dir, 'in', 'a', 'mutation.json'),
      join(dir, 'in', 'b', 'mutation.json'),
    ]);
  });

  it('writes into a nested directory that does not exist yet', () => {
    quiet();
    const a = write('a.json', rawReport({ files: { 'src/a.ts': { mutants: [] } } }));
    const out = join(dir, 'x', 'y', 'z');
    mergeMain(['--out', out, '--no-html', a]);
    expect(JSON.parse(readFileSync(join(out, 'mutation.json'), 'utf-8')).files).toHaveProperty(
      'src/a.ts',
    );
  });

  it('carries the source of a test file over', () => {
    const merged = mergeReports([
      rawReport({ testFiles: { 'src/x.test.ts': { source: 'the test source', tests: [] } } }),
    ]) as unknown as { testFiles: Record<string, { source?: string }> };
    expect(merged.testFiles['src/x.test.ts']?.source).toBe('the test source');
  });

  it('keeps the other fields when it restricts a report', () => {
    const restricted = restrictReport(
      rawReport({
        files: { 'src/a.ts': { mutants: [] }, 'src/b.ts': { mutants: [] } },
        testFiles: { 'src/x.test.ts': { tests: [] } },
      }),
      ['src/a.ts'],
    ) as Record<string, unknown>;
    expect(restricted.projectRoot).toBe('/repo');
    expect(restricted.schemaVersion).toBe('1.0');
    expect(restricted.testFiles).toEqual({ 'src/x.test.ts': { tests: [] } });
  });
});

describe('test identity in a merge', () => {
  type Merged = { testFiles: Record<string, { tests: Array<{ id: string; name: string }> }> };
  const test = (id: string, name: string, line: number, column: number) => ({
    id,
    name,
    location: { start: { line, column } },
  });
  const withTests = (testFiles: Record<string, unknown[]>) =>
    rawReport({
      testFiles: Object.fromEntries(
        Object.entries(testFiles).map(([path, tests]) => [path, { tests }]),
      ),
    });
  const count = (merged: Merged, path: string) => merged.testFiles[path]?.tests.length;

  it('keeps the same name at another line a separate test', () => {
    const merged = mergeReports([
      withTests({ 'src/x.test.ts': [test('0', 'same', 1, 1)] }),
      withTests({ 'src/x.test.ts': [test('0', 'same', 2, 1)] }),
    ]) as unknown as Merged;
    expect(count(merged, 'src/x.test.ts')).toBe(2);
  });

  it('keeps the same name at another column a separate test', () => {
    const merged = mergeReports([
      withTests({ 'src/x.test.ts': [test('0', 'same', 1, 1)] }),
      withTests({ 'src/x.test.ts': [test('0', 'same', 1, 2)] }),
    ]) as unknown as Merged;
    expect(count(merged, 'src/x.test.ts')).toBe(2);
  });

  it('keeps the same name and position in another test file a separate test', () => {
    const merged = mergeReports([
      withTests({ 'src/x.test.ts': [test('0', 'same', 1, 1)] }),
      withTests({ 'src/y.test.ts': [test('0', 'same', 1, 1)] }),
    ]) as unknown as Merged;
    expect(count(merged, 'src/x.test.ts')).toBe(1);
    expect(count(merged, 'src/y.test.ts')).toBe(1);
    const ids = Object.values(merged.testFiles).flatMap((f) => f.tests.map((t) => t.id));
    expect(new Set(ids).size).toBe(2);
  });

  it('keeps a different name a separate test, and the same test one test', () => {
    const merged = mergeReports([
      withTests({ 'src/x.test.ts': [test('0', 'one', 1, 1)] }),
      withTests({ 'src/x.test.ts': [test('0', 'two', 1, 1), test('1', 'one', 1, 1)] }),
    ]) as unknown as Merged;
    expect(merged.testFiles['src/x.test.ts']?.tests.map((t) => t.name)).toEqual(['one', 'two']);
  });

  it('drops a test id that no test file knows, instead of writing undefined', () => {
    const merged = mergeReports([
      rawReport({
        files: {
          'src/a.ts': {
            mutants: [{ id: '0', status: 'Killed', coveredBy: ['0', '99'], killedBy: ['99', '0'] }],
          },
        },
        testFiles: { 'src/x.test.ts': { tests: [test('0', 't', 1, 1)] } },
      }),
    ]) as unknown as { files: Record<string, { mutants: Array<Record<string, unknown>> }> };
    const mutant = merged.files['src/a.ts']!.mutants[0]!;
    expect(mutant.coveredBy).toEqual(['0']);
    expect(mutant.killedBy).toEqual(['0']);
  });
});
