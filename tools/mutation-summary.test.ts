import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { analyze, badgeColor, buildBadge, buildSummary, main, tally } from './mutation-summary.mjs';

const m = (status: string) => ({ status });
const many = (status: string, n: number) => Array.from({ length: n }, () => m(status));

describe('tally', () => {
  it('scores killed and timeout as detected against survived and no coverage', () => {
    const t = tally([m('Killed'), m('Timeout'), m('Survived'), m('NoCoverage')]);
    expect(t).toMatchObject({ killed: 1, timeout: 1, survived: 1, noCoverage: 1 });
    expect(t.score).toBe(50);
  });

  it('leaves errors and ignored mutants out of the score', () => {
    const t = tally([m('Killed'), m('CompileError'), m('RuntimeError'), m('Ignored')]);
    expect(t).toMatchObject({ errors: 2, ignored: 1 });
    expect(t.score).toBe(100);
  });

  it('has no score without a valid mutant', () => {
    expect(tally([m('Ignored')]).score).toBeNull();
    expect(tally([]).score).toBeNull();
  });
});

describe('analyze', () => {
  it('totals over all files and keeps each file apart', () => {
    const { total, files } = analyze({
      files: {
        'src/a.ts': { mutants: [m('Killed'), m('Killed')] },
        'src/b.ts': { mutants: [m('Survived'), m('Killed')] },
      },
    });
    expect(total.score).toBe(75);
    expect(files.map((f: { path: string; score: number | null }) => [f.path, f.score])).toEqual([
      ['src/a.ts', 100],
      ['src/b.ts', 50],
    ]);
  });
});

describe('badge', () => {
  it('uses the shields.io endpoint format', () => {
    expect(buildBadge(83.456)).toEqual({
      schemaVersion: 1,
      label: 'mutation score',
      message: '83.5 %',
      color: 'brightgreen',
    });
  });

  it('colours at the Stryker thresholds', () => {
    expect(badgeColor(80)).toBe('brightgreen');
    expect(badgeColor(79.9)).toBe('yellow');
    expect(badgeColor(60)).toBe('yellow');
    expect(badgeColor(59.9)).toBe('red');
    expect(badgeColor(null)).toBe('lightgrey');
    expect(buildBadge(null).message).toBe('n/a');
  });
});

describe('buildSummary', () => {
  it('lists the ten lowest-scoring files, worst first, and the counts', () => {
    const files: Record<string, { mutants: { status: string }[] }> = {};
    for (let i = 0; i < 12; i++) {
      // File i has i survivors among 20 mutants, so a higher i scores lower.
      files[`src/f${i}.ts`] = { mutants: [...many('Killed', 20 - i), ...many('Survived', i)] };
    }
    const text = buildSummary(analyze({ files }));
    expect(text).toContain('Mutation score: **');
    expect(text).toContain('| Killed | Survived | Timeout | No coverage | Errors |');
    const listed = [...text.matchAll(/`(src\/f\d+\.ts)`/g)].map((x) => x[1]);
    expect(listed).toEqual(Array.from({ length: 10 }, (_, k) => `src/f${11 - k}.ts`));
  });

  it('says so when no file has a score', () => {
    expect(buildSummary(analyze({ files: {} }))).toContain('No file has a score.');
  });
});

describe('main', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mutation-summary-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('appends the summary to the step summary file and writes the badge', () => {
    const report = join(dir, 'mutation.json');
    const summary = join(dir, 'summary.md');
    const badge = join(dir, 'site', 'badge.json');
    writeFileSync(
      report,
      JSON.stringify({ files: { 'src/a.ts': { mutants: [m('Killed'), m('Survived')] } } }),
    );
    main(['--report', report, '--badge', badge], { GITHUB_STEP_SUMMARY: summary });
    expect(readFileSync(summary, 'utf-8')).toContain('**50.0 %**');
    expect(JSON.parse(readFileSync(badge, 'utf-8'))).toMatchObject({
      message: '50.0 %',
      color: 'red',
    });
  });

  it('throws when the report is missing, so the job fails instead of publishing nothing', () => {
    expect(() => main(['--report', join(dir, 'nope.json')], {})).toThrow();
  });
});
