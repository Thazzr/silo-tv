// The baseline of the weekly mutation run: --break in the summary, --check as the failing step, and
// the workflow that wires both.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main, parseBreak } from './mutation-summary.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const many = (status: string, n: number) => Array.from({ length: n }, () => ({ status }));

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mutation-baseline-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** A report whose score is `killed` of `total` mutants. */
function reportWith(killed: number, total: number) {
  const path = join(dir, 'mutation.json');
  const mutants = [...many('Killed', killed), ...many('Survived', total - killed)];
  writeFileSync(path, JSON.stringify({ files: { 'src/a.ts': { mutants } } }));
  return path;
}

function summarize(report: string, extra: string[]) {
  const summary = join(dir, 'summary.md');
  const output = join(dir, 'output.txt');
  writeFileSync(summary, '');
  writeFileSync(output, '');
  const code = main(['--report', report, ...extra], {
    GITHUB_STEP_SUMMARY: summary,
    GITHUB_OUTPUT: output,
  });
  return {
    code,
    summary: readFileSync(summary, 'utf-8'),
    output: readFileSync(output, 'utf-8'),
  };
}

function check(score: string, breakAt?: string) {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const argv = ['--check', score, ...(breakAt === undefined ? [] : ['--break', breakAt])];
  const code = main(argv, {});
  return { code, lines: log.mock.calls.map((call) => String(call[0])) };
}

describe('--break in the summary', () => {
  it('says the baseline is held at an equal score', () => {
    // 77 of 100 is exactly 77.0 %.
    const { summary, code } = summarize(reportWith(77, 100), ['--break', '77']);
    expect(summary).toContain('Mutation score: **77.0 %**\n\nBaseline: 77.0 %, held.');
    expect(code).toBe(0);
  });

  it('rounds to one decimal before comparing, so 76.96 shows as 77.0 and is held', () => {
    // 7696 of 10000 is 76.96 %, which the badge and the output show as 77.0 %.
    const { summary, output, code } = summarize(reportWith(7696, 10000), ['--break', '77']);
    expect(summary).toContain('Baseline: 77.0 %, held.');
    expect(output).toBe('score=77.0\nbelow_break=false\n');
    expect(code).toBe(0);
  });

  it('says the baseline is held above it', () => {
    expect(summarize(reportWith(80, 100), ['--break', '77']).summary).toContain(
      'Baseline: 77.0 %, held.',
    );
  });

  it('says this run is below the baseline, and still returns 0', () => {
    // 769 of 1000 is 76.9 %.
    const { summary, code } = summarize(reportWith(769, 1000), ['--break', '77']);
    expect(summary).toContain('Baseline: 77.0 %, this run is below it.');
    expect(code).toBe(0);
  });

  it('writes no baseline line without --break', () => {
    expect(summarize(reportWith(80, 100), []).summary).not.toContain('Baseline');
  });
});

describe('GITHUB_OUTPUT', () => {
  it('gets score and below_break with --break', () => {
    expect(summarize(reportWith(769, 1000), ['--break', '77']).output).toBe(
      'score=76.9\nbelow_break=true\n',
    );
    expect(summarize(reportWith(77, 100), ['--break', '77']).output).toBe(
      'score=77.0\nbelow_break=false\n',
    );
  });

  it('gets only the score without --break', () => {
    expect(summarize(reportWith(80, 100), []).output).toBe('score=80.0\n');
  });

  it('gets an empty score and below_break=true for a report without a score', () => {
    const path = join(dir, 'empty.json');
    writeFileSync(path, JSON.stringify({ files: {} }));
    const { output, summary, code } = summarize(path, ['--break', '77']);
    expect(output).toBe('score=\nbelow_break=true\n');
    expect(summary).toContain('Baseline: 77.0 %, this run is below it.');
    expect(code).toBe(0);
  });

  it('is left alone when the variable is not set', () => {
    const output = join(dir, 'output.txt');
    writeFileSync(output, '');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(main(['--report', reportWith(80, 100), '--break', '77'], {})).toBe(0);
    expect(readFileSync(output, 'utf-8')).toBe('');
  });
});

describe('--check', () => {
  it.each([
    ['79.3', '77'],
    ['77', '77'],
    ['77.0', '77'],
  ])('passes %s against %s', (score, breakAt) => {
    const { code, lines } = check(score, breakAt);
    expect(code).toBe(0);
    expect(lines).toEqual([]);
  });

  it('rounds the score to one decimal before comparing', () => {
    expect(check('76.96', '77').code).toBe(0);
  });

  it('fails below the baseline with the error line', () => {
    const { code, lines } = check('76.9', '77');
    expect(code).toBe(1);
    expect(lines).toEqual(['::error::Mutation score 76.9 % is below the baseline of 77.0 %.']);
  });

  it.each(['', 'abc', 'NaN', '-5'])('fails without a usable score (%j)', (score) => {
    const { code, lines } = check(score, '77');
    expect(code).toBe(1);
    expect(lines).toEqual(['::error::No mutation score to check.']);
  });

  it('fails when --check has no value at all', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(main(['--check', '--break', '77'], {})).toBe(1);
    expect(log).toHaveBeenCalledWith('::error::No mutation score to check.');
  });

  it('reads no report and writes no summary', () => {
    const summary = join(dir, 'summary.md');
    writeFileSync(summary, '');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = main(['--check', '80', '--break', '77', '--report', join(dir, 'nope.json')], {
      GITHUB_STEP_SUMMARY: summary,
    });
    expect(code).toBe(0);
    expect(readFileSync(summary, 'utf-8')).toBe('');
  });
});

describe('an invalid --break', () => {
  it.each(['-1', '101', 'x', '', '7 7'])('is a usage error in both modes (%j)', (value) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(main(['--report', reportWith(80, 100), '--break', value], {})).toBe(2);
    expect(main(['--check', '80', '--break', value], {})).toBe(2);
  });

  it('is a usage error when the value is missing', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(main(['--report', reportWith(80, 100), '--break'], {})).toBe(2);
    expect(main(['--check', '80', '--break'], {})).toBe(2);
  });

  it('is a usage error when --check comes without --break', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(main(['--check', '80'], {})).toBe(2);
  });

  it('accepts the limits 0 and 100', () => {
    expect(parseBreak(['--break', '0'])).toBe(0);
    expect(parseBreak(['--break', '100'])).toBe(100);
    expect(parseBreak([])).toBeNull();
  });
});

describe('the command line', () => {
  const run = (args: string[]) =>
    spawnSync(process.execPath, [join(ROOT, 'tools', 'mutation-summary.mjs'), ...args], {
      cwd: ROOT,
      encoding: 'utf-8',
    });

  it('exits 1 and prints the error line to stdout below the baseline', () => {
    const result = run(['--check', '76.9', '--break', '77']);
    expect(result.status).toBe(1);
    expect(result.stdout.trim()).toBe(
      '::error::Mutation score 76.9 % is below the baseline of 77.0 %.',
    );
  });

  it('exits 0 at the baseline and 2 for an invalid break', () => {
    expect(run(['--check', '77', '--break', '77']).status).toBe(0);
    expect(run(['--check', '77', '--break', '101']).status).toBe(2);
  });

  it('exits 0 for the summary run below the baseline', () => {
    const result = run(['--report', reportWith(1, 2), '--break', '77']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('this run is below it');
  });
});

describe('the workflow', () => {
  // A Windows checkout may have CRLF line endings.
  const yaml = readFileSync(join(ROOT, '.github', 'workflows', 'mutation.yml'), 'utf-8').replace(
    /\r\n/g,
    '\n',
  );
  /** The text of one top-level job, up to the next job. */
  const job = (name: string) => {
    const start = yaml.indexOf(`\n  ${name}:\n`);
    expect(start).toBeGreaterThan(-1);
    const rest = yaml.slice(start + 1);
    const next = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/);
    return next < 0 ? rest : rest.slice(0, next + 1);
  };

  it('defines the baseline once for the whole workflow', () => {
    expect(yaml).toMatch(/^env:\n(?: {2}.*\n)+/m);
    expect(yaml).toMatch(/^ {2}MUTATION_BREAK: '\d+(\.\d+)?'$/m);
  });

  it('hands the score of the summary step to the baseline job', () => {
    const report = job('report');
    expect(report).toMatch(/outputs:\n\s+score: \$\{\{ steps\.summary\.outputs\.score \}\}/);
    expect(report).toMatch(/id: summary\n\s+run: \|[\s\S]*--break "\$MUTATION_BREAK"/);
  });

  it('runs the baseline job after report and pages, even when pages is skipped', () => {
    const baseline = job('baseline');
    expect(baseline).toMatch(/needs: \[report, pages\]/);
    expect(baseline).toContain("if: always() && needs.report.result == 'success'");
    expect(baseline).toMatch(/permissions:\n\s+contents: read/);
  });

  it('passes the score through an env var, not into the script text', () => {
    const baseline = job('baseline');
    expect(baseline).toContain('SCORE: ${{ needs.report.outputs.score }}');
    expect(baseline).toContain(
      'run: node tools/mutation-summary.mjs --check "$SCORE" --break "$MUTATION_BREAK"',
    );
    const runLines = baseline.split('\n').filter((line) => /^\s+run:/.test(line));
    expect(runLines.some((line) => line.includes('${{'))).toBe(false);
  });
});
