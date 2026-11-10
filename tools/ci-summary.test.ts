import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSummary, main, parseGateTable, parseJunit, summarize } from './ci-summary.mjs';

const VITEST_XML = `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites name="vitest tests" tests="3" failures="1" errors="0" time="1.2">
    <testsuite name="a.test.ts" tests="3" failures="1" errors="0" skipped="0" time="1.2">
        <testcase classname="a.test.ts" name="group &gt; works" time="0.1">
        </testcase>
        <testcase classname="a.test.ts" name="group &gt; breaks &amp; burns" time="0.1">
            <failure message="expected 1 to be 2" type="AssertionError">trace</failure>
        </testcase>
        <testcase classname="a.test.ts" name="group &gt; later" time="0">
            <skipped/>
        </testcase>
    </testsuite>
</testsuites>`;

const PLAYWRIGHT_XML = `<testsuites id="" name="" tests="2" failures="1" skipped="0" errors="0" time="9">
<testsuite name="home.spec.ts" tests="2" failures="1" skipped="0" errors="0">
<testcase name="opens home" classname="home.spec.ts" time="1"/>
<testcase name="plays video" classname="home.spec.ts" time="2">
<failure message="timeout" type="FAILURE">stack</failure>
</testcase>
</testsuite>
</testsuites>`;

const GATE = `==> lint (0:09)

==> summary
Step                 Time  Result
lint                 0:09  ok
e2e                  1:02  failed (exit 1)
Total: 1:11
`;

const COVERAGE = JSON.stringify({
  total: {
    lines: { pct: 81.5 },
    statements: { pct: 80 },
    functions: { pct: 70.25 },
    branches: { pct: 65 },
  },
});

describe('parseJunit', () => {
  it('counts passed, failed and skipped cases and names the failures', () => {
    expect(parseJunit(VITEST_XML)).toEqual({
      total: 3,
      passed: 1,
      failed: 1,
      skipped: 1,
      failedNames: ['a.test.ts > group > breaks & burns'],
    });
  });

  it('reads the Playwright flavour with self-closing test cases', () => {
    const result = parseJunit(PLAYWRIGHT_XML);
    expect(result).toMatchObject({ total: 2, passed: 1, failed: 1, skipped: 0 });
    expect(result.failedNames).toEqual(['home.spec.ts > plays video']);
  });

  it('counts an <error> child as a failure', () => {
    const xml = '<testcase classname="x" name="boom"><error message="m"/></testcase>';
    expect(parseJunit(xml).failed).toBe(1);
  });

  it('returns zeros for a file without test cases', () => {
    expect(parseJunit('<testsuites/>')).toEqual({
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      failedNames: [],
    });
  });
});

describe('parseGateTable', () => {
  it('returns the lines after the summary marker without blank lines', () => {
    expect(parseGateTable(GATE)).toEqual([
      'Step                 Time  Result',
      'lint                 0:09  ok',
      'e2e                  1:02  failed (exit 1)',
      'Total: 1:11',
    ]);
  });

  it('returns null without a summary marker', () => {
    expect(parseGateTable('==> lint (0:09)\n')).toBeNull();
  });
});

describe('buildSummary', () => {
  it('shows the gate table, both totals, the failed names and the coverage', () => {
    const md = buildSummary({
      gate: { text: GATE },
      unit: { text: VITEST_XML },
      e2e: { text: PLAYWRIGHT_XML },
      coverage: { text: COVERAGE },
    });
    expect(md).toContain('e2e                  1:02  failed (exit 1)');
    expect(md).toContain('| 3 | 1 | 1 | 1 |');
    expect(md).toContain('| 2 | 1 | 1 | 0 |');
    expect(md).toContain('- `a.test.ts > group > breaks & burns`');
    expect(md).toContain('- `home.spec.ts > plays video`');
    expect(md).toContain('| 80% | 65% | 70.25% | 81.5% |');
  });

  it('says so, per section, when an input is missing, and still renders the others', () => {
    const md = buildSummary({
      gate: { error: '`reports/gate.txt`: file not found' },
      unit: { text: VITEST_XML },
      e2e: { error: '`reports/e2e-junit.xml`: file not found' },
      coverage: { error: '`reports/coverage/coverage-summary.json`: file not found' },
    });
    expect(md).toContain('Not available: `reports/gate.txt`: file not found.');
    expect(md).toContain('Not available: `reports/e2e-junit.xml`: file not found.');
    expect(md).toContain(
      'Not available: `reports/coverage/coverage-summary.json`: file not found.',
    );
    expect(md).toContain('| 3 | 1 | 1 | 1 |');
  });

  it('survives a coverage file that is not JSON or has no totals', () => {
    const base = {
      gate: { text: GATE },
      unit: { text: VITEST_XML },
      e2e: { text: PLAYWRIGHT_XML },
    };
    expect(buildSummary({ ...base, coverage: { text: '{nope' } })).toContain('not valid JSON');
    expect(buildSummary({ ...base, coverage: { text: '{}' } })).toContain('has no totals');
  });
});

describe('summarize and main', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ci-summary-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads the files from disk and reports each missing one', () => {
    writeFileSync(join(dir, 'unit.xml'), VITEST_XML);
    const md = summarize({
      gate: join(dir, 'gate.txt'),
      unit: join(dir, 'unit.xml'),
      e2e: join(dir, 'e2e.xml'),
      coverage: join(dir, 'cov.json'),
    });
    expect(md).toContain('| 3 | 1 | 1 | 1 |');
    expect(md).toContain('file not found');
  });

  it('appends to $GITHUB_STEP_SUMMARY and does not throw when every file is missing', () => {
    const target = join(dir, 'step-summary.md');
    const previous = process.cwd();
    process.chdir(dir);
    try {
      expect(() => main({ GITHUB_STEP_SUMMARY: target })).not.toThrow();
    } finally {
      process.chdir(previous);
    }
    const written = readFileSync(target, 'utf-8');
    expect(written).toContain('# Verification gate');
    expect(written.match(/Not available/g)).toHaveLength(4);
  });
});
