// The test results card: `collect` (CI side), `render` (Pages side), mutation-summary's --json and
// the three workflows that wire them.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main as mutationMain } from './mutation-summary.mjs';
import {
  collect,
  escapeXml,
  formatDateTime,
  main,
  parseGateSteps,
  renderCard,
  renderIndex,
} from './status-card.mjs';

const ROOT = resolve(import.meta.dirname, '..');

const GATE = `==> lint (0:09)

==> summary
Step                 Time  Result
verify script tests  0:12  ok
typecheck            0:20  ok
lint                 0:09  ok
unit tests           1:05  ok
build                0:30  ok
bundle check         0:02  ok
e2e                  1:02  failed (exit 1)
package              0:07  ok
Total: 3:27
`;

const junit = (cases: string) => `<testsuites>${cases}</testsuites>`;
const UNIT_XML = junit(
  '<testcase classname="a" name="x"/><testcase classname="a" name="y"/><testcase classname="a" name="z"><skipped/></testcase>',
);
const E2E_XML = junit(
  '<testcase classname="e" name="x"/><testcase classname="e" name="y"><failure message="m"/></testcase>',
);
const COVERAGE = JSON.stringify({
  total: {
    lines: { pct: 81.5 },
    statements: { pct: 80 },
    functions: { pct: 70.25 },
    branches: { pct: 65 },
  },
});

const ENV = {
  GITHUB_SHA: 'abcdef0123456789abcdef0123456789abcdef01',
  GITHUB_REF_NAME: 'main',
  GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_REPOSITORY: 'owner/repo',
  GITHUB_RUN_ID: '4242',
};
const NOW = new Date('2026-11-11T14:05:59Z');

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'status-card-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function files(
  overrides: Partial<Record<'gate' | 'unit' | 'e2e' | 'coverage', string | null>> = {},
) {
  const content = { gate: GATE, unit: UNIT_XML, e2e: E2E_XML, coverage: COVERAGE, ...overrides };
  const paths = {} as Record<'gate' | 'unit' | 'e2e' | 'coverage', string>;
  for (const [key, text] of Object.entries(content)) {
    const path = join(dir, `${key}.txt`);
    if (text !== null) writeFileSync(path, text);
    paths[key as keyof typeof paths] = path;
  }
  return paths;
}

describe('parseGateSteps', () => {
  it('reads name, time and result of every row in gate order and skips header and total', () => {
    const steps = parseGateSteps(GATE);
    expect(steps?.map((step) => step.name)).toEqual([
      'verify script tests',
      'typecheck',
      'lint',
      'unit tests',
      'build',
      'bundle check',
      'e2e',
      'package',
    ]);
    expect(steps?.[0]).toEqual({ name: 'verify script tests', time: '0:12', result: 'ok' });
    expect(steps?.[6]).toEqual({ name: 'e2e', time: '1:02', result: 'failed' });
  });

  it('reads a skipped step with its "-" time', () => {
    const text = '==> summary\nStep  Time  Result\nbundle check      -  skipped (build failed)\n';
    expect(parseGateSteps(text)).toEqual([{ name: 'bundle check', time: '-', result: 'skipped' }]);
  });

  it('returns null without a table', () => {
    expect(parseGateSteps('nothing')).toBeNull();
  });
});

describe('collect', () => {
  it('reads steps, counts, coverage and the environment', () => {
    const status = collect(files(), ENV, NOW);
    expect(status.steps).toHaveLength(8);
    expect(status.unit).toEqual({ total: 3, passed: 2, failed: 0, skipped: 1 });
    expect(status.e2e).toEqual({ total: 2, passed: 1, failed: 1, skipped: 0 });
    expect(status.coverage).toEqual({
      statements: 80,
      branches: 65,
      functions: 70.25,
      lines: 81.5,
    });
    expect(status.sha).toBe(ENV.GITHUB_SHA);
    expect(status.shaShort).toBe('abcdef0');
    expect(status.ref).toBe('main');
    expect(status.runUrl).toBe('https://github.com/owner/repo/actions/runs/4242');
    expect(status.finishedAt).toBe('2026-11-11T14:05:59.000Z');
  });

  it('is not ok when a step failed', () => {
    expect(collect(files(), ENV, NOW).ok).toBe(false);
  });

  it('is ok when every step is ok or skipped', () => {
    const gate =
      '==> summary\nStep Time Result\nlint  0:01  ok\nbundle check  -  skipped (x)\nTotal: 0:01\n';
    expect(collect(files({ gate }), ENV, NOW).ok).toBe(true);
  });

  it.each([
    ['gate', 'steps', null],
    ['unit', 'unit', null],
    ['e2e', 'e2e', null],
    ['coverage', 'coverage', null],
  ] as const)(
    'leaves %s null when its file is missing and keeps the rest',
    (key, field, expected) => {
      const status = collect(files({ [key]: null }), ENV, NOW);
      expect(status[field]).toBe(expected);
      if (key !== 'gate') expect(status.steps).toHaveLength(8);
      if (key !== 'unit') expect(status.unit).not.toBeNull();
    },
  );

  it('has ok null without a gate table', () => {
    expect(collect(files({ gate: null }), ENV, NOW).ok).toBeNull();
  });

  it('leaves coverage null for a file that is not JSON', () => {
    expect(collect(files({ coverage: 'x' }), ENV, NOW).coverage).toBeNull();
  });

  it('leaves the environment fields null without GITHUB_* variables', () => {
    const status = collect(files(), {}, NOW);
    expect(status).toMatchObject({ sha: null, shaShort: null, ref: null, runUrl: null });
  });
});

const CI = collect(
  {
    gate: '',
    unit: '',
    e2e: '',
    coverage: '',
  },
  ENV,
  NOW,
);
const GREEN = {
  ...CI,
  ok: true,
  steps: [
    { name: 'typecheck', time: '0:20', result: 'ok' },
    { name: 'e2e', time: '1:02', result: 'skipped' },
  ],
  unit: { total: 3170, passed: 3170, failed: 0, skipped: 0 },
  e2e: { total: 40, passed: 40, failed: 0, skipped: 0 },
  coverage: { statements: 80, branches: 65, functions: 70.25, lines: 81.5 },
};
const RED = {
  ...GREEN,
  ok: false,
  steps: [
    { name: 'typecheck', time: '0:20', result: 'ok' },
    { name: 'lint', time: '0:09', result: 'failed' },
  ],
  unit: { total: 3170, passed: 3167, failed: 3, skipped: 0 },
};
const MUTATION = {
  score: 79.3,
  killed: 1,
  survived: 1,
  timeout: 0,
  noCoverage: 0,
  errors: 0,
  total: 2,
  baseline: 77,
  belowBaseline: false,
  finishedAt: '2026-11-09T02:30:00.000Z',
  sha: 'abc',
};

const texts = (svg: string) => [...svg.matchAll(/>([^<]+)<\/text>/g)].map((match) => match[1]);

describe('renderCard texts', () => {
  const svg = renderCard(GREEN, MUTATION, 'light');

  it('writes the header with ref, short sha and the UTC date', () => {
    expect(texts(svg)).toContain('silo-tv \u00B7 test results');
    expect(texts(svg)).toContain('main @ abcdef0 \u00B7 2026-11-11 14:05 UTC');
  });

  it('writes the passing counts for unit and E2E', () => {
    expect(texts(svg)).toContain('3170 passed');
    expect(texts(svg)).toContain('40 passed');
  });

  it('writes "N failed of TOTAL" when tests fail', () => {
    expect(texts(renderCard(RED, MUTATION, 'light'))).toContain('3 failed of 3170');
  });

  it('writes the skipped count as a sub line of the tile', () => {
    const ci = { ...GREEN, unit: { total: 3170, passed: 3165, failed: 0, skipped: 5 } };
    const found = texts(renderCard(ci, MUTATION, 'light'));
    expect(found).toContain('3165 passed');
    expect(found).toContain('5 skipped');
    expect(texts(svg)).not.toContain('0 skipped');
  });

  it('writes lines coverage and the three others small below', () => {
    expect(texts(svg)).toEqual(
      expect.arrayContaining([
        '81.5 %',
        'statements 80.0 %',
        'branches 65.0 %',
        'functions 70.3 %',
      ]),
    );
  });

  it('writes the mutation score, the baseline and the run date', () => {
    expect(texts(svg)).toEqual(expect.arrayContaining(['79.3 %', 'baseline 77 %', '2026-11-09']));
  });

  it('writes one chip per step with its mark and time', () => {
    expect(texts(svg)).toEqual(
      expect.arrayContaining(['\u2713', 'typecheck', '0:20', '\u2013', 'e2e', '1:02']),
    );
    expect(texts(renderCard(RED, MUTATION, 'light'))).toContain('\u2717');
  });

  it('says "no recent run" for a missing CI file, in the header and the tiles', () => {
    const none = texts(renderCard(null, MUTATION, 'light'));
    expect(none.filter((text) => text === 'no recent run').length).toBeGreaterThanOrEqual(5);
    expect(none).toContain('79.3 %');
  });

  it('says "no recent run" for a missing mutation file and keeps the CI part', () => {
    const none = texts(renderCard(GREEN, null, 'light'));
    expect(none.filter((text) => text === 'no recent run')).toHaveLength(1);
    expect(none).toContain('3170 passed');
  });
});

describe('renderCard colours', () => {
  /** The fill of the text node with the given content. */
  const fillOf = (svg: string, text: string) =>
    new RegExp(`fill="([^"]+)">${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</text>`).exec(
      svg,
    )?.[1];

  it('colours a passed step green and a failed one red in the light variant', () => {
    const svg = renderCard(RED, MUTATION, 'light');
    expect(fillOf(svg, '\u2713')).toBe('#1A7F37');
    expect(fillOf(svg, '\u2717')).toBe('#CF222E');
    expect(fillOf(svg, '3 failed of 3170')).toBe('#CF222E');
  });

  it('colours a passed step green and a failed one red in the dark variant', () => {
    const svg = renderCard(RED, MUTATION, 'dark');
    expect(fillOf(svg, '\u2713')).toBe('#3FB950');
    expect(fillOf(svg, '\u2717')).toBe('#F85149');
  });

  it('uses the frame, background and text colours of each variant', () => {
    const dark = renderCard(GREEN, MUTATION, 'dark');
    expect(dark).toContain('fill="#0A0A0A" stroke="rgba(255,255,255,0.12)"');
    expect(fillOf(dark, 'typecheck')).toBe('#EDEDED');
    expect(fillOf(dark, '0:20')).toBe('rgba(237,237,237,0.6)');
    const light = renderCard(GREEN, MUTATION, 'light');
    expect(light).toContain('fill="#FFFFFF" stroke="#D0D7DE"');
    expect(fillOf(light, 'typecheck')).toBe('#1F2328');
    expect(fillOf(light, '0:20')).toBe('#59636E');
  });

  it('colours a skipped step with the secondary colour', () => {
    expect(fillOf(renderCard(GREEN, MUTATION, 'light'), '\u2013')).toBe('#59636E');
  });

  it.each([
    [80, '#1A7F37'],
    [79.9, '#9A6700'],
    [60, '#9A6700'],
    [59.9, '#CF222E'],
  ])('colours a mutation score of %s by the badge thresholds', (score, colour) => {
    const svg = renderCard(GREEN, { ...MUTATION, score }, 'light');
    expect(fillOf(svg, `${score.toFixed(1)} %`)).toBe(colour);
  });

  it('colours the baseline line red when the run is below it', () => {
    const svg = renderCard(GREEN, { ...MUTATION, belowBaseline: true }, 'light');
    expect(fillOf(svg, 'baseline 77 %')).toBe('#CF222E');
    expect(fillOf(renderCard(GREEN, MUTATION, 'light'), 'baseline 77 %')).toBe('#59636E');
  });
});

describe('renderCard output', () => {
  it('escapes <, & and " in a step name and a ref', () => {
    const ci = {
      ...GREEN,
      ref: 'feat/<a&"b">',
      steps: [{ name: 'a<b & "c"', time: '0:01', result: 'ok' }],
    };
    const svg = renderCard(ci, MUTATION, 'light');
    expect(svg).toContain('a&lt;b &amp; &quot;c&quot;');
    expect(svg).toContain('feat/&lt;a&amp;&quot;b&quot;&gt; @ abcdef0');
    expect(svg).not.toContain('a<b');
  });

  it('drops control characters XML does not allow', () => {
    expect(escapeXml('a\u0001b\u000Bc')).toBe('abc');
  });

  /** A small well-formedness check: balanced tags and no bare ampersand. */
  function assertWellFormed(xml: string) {
    expect(xml).not.toMatch(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/);
    const body = xml.replace(/<\?xml[^>]*\?>/, '');
    const stack: string[] = [];
    const tags = /<(\/?)([A-Za-z][\w:-]*)(?:\s(?:"[^"]*"|[^>"])*?)?(\/?)>/g;
    for (const [, closing, name, selfClosing] of body.matchAll(tags)) {
      if (selfClosing) continue;
      if (closing) expect(stack.pop()).toBe(name);
      else stack.push(name ?? '');
    }
    expect(stack).toEqual([]);
    // No stray "<" outside tags: every "<" starts a tag matched above.
    expect(body.replace(/<\/?[A-Za-z][^>]*>/g, '')).not.toContain('<');
  }

  it.each(['light', 'dark'] as const)('is well-formed XML in the %s variant', (variant) => {
    const evil = { ...GREEN, ref: 'a&b<c', steps: [{ name: '"x"', time: '1', result: 'failed' }] };
    assertWellFormed(renderCard(GREEN, MUTATION, variant));
    assertWellFormed(renderCard(evil, MUTATION, variant));
    assertWellFormed(renderCard(null, null, variant));
  });

  it('has no script, external link, import or foreign resource', () => {
    for (const svg of [renderCard(GREEN, MUTATION, 'light'), renderCard(null, null, 'dark')]) {
      expect(svg).not.toContain('<script');
      expect(svg).not.toMatch(/href="http/);
      expect(svg).not.toContain('@import');
      expect(svg).not.toContain('<image');
      expect(svg).not.toContain('url(');
    }
  });

  it('is 880x300 with a rounded frame and the system font stack', () => {
    const svg = renderCard(GREEN, MUTATION, 'light');
    expect(svg).toContain('width="880" height="300"');
    expect(svg).toContain('rx="14"');
    expect(svg).toContain('-apple-system, &quot;Segoe UI&quot;, Helvetica, Arial, sans-serif');
  });
});

describe('formatDateTime', () => {
  it('formats UTC and rejects invalid input', () => {
    expect(formatDateTime('2026-11-11T14:05:59Z')).toBe('2026-11-11 14:05 UTC');
    expect(formatDateTime('nope')).toBeNull();
    expect(formatDateTime(undefined)).toBeNull();
  });
});

describe('renderIndex', () => {
  it('links the card, the CI runs and the mutation report only when there is one', () => {
    const page = renderIndex({ repository: 'owner/repo', hasMutation: true });
    expect(page).toContain('src="status/test-results-light.svg"');
    expect(page).toContain('href="mutation/"');
    expect(page).toContain('https://github.com/owner/repo/actions/workflows/ci.yml');
    expect(renderIndex({ repository: 'owner/repo', hasMutation: false })).not.toContain(
      'href="mutation/"',
    );
  });
});

describe('the command line', () => {
  it('collect writes the status file; render writes both SVGs; a missing input is fine', () => {
    const quiet = { ...process.env };
    for (const key of Object.keys(quiet)) if (key.startsWith('GITHUB_')) delete quiet[key];
    const run = (args: string[]) =>
      spawnSync(process.execPath, [join(ROOT, 'tools', 'status-card.mjs'), ...args], {
        cwd: dir,
        encoding: 'utf-8',
        env: quiet,
      });
    expect(run(['collect', '--out', 'status/ci-status.json']).status).toBe(0);
    const status = JSON.parse(readFileSync(join(dir, 'status', 'ci-status.json'), 'utf-8'));
    expect(status.steps).toBeNull();
    expect(
      run(['render', '--ci', 'status/ci-status.json', '--mutation', 'absent.json', '--out', 'site'])
        .status,
    ).toBe(0);
    expect(readFileSync(join(dir, 'site', 'test-results-dark.svg'), 'utf-8')).toContain('<svg');
    expect(readFileSync(join(dir, 'site', 'test-results-light.svg'), 'utf-8')).toContain('<svg');
    expect(run(['render']).status).toBe(2);
    expect(run(['nope']).status).toBe(2);
  });

  it('main collect uses the injected environment and clock', () => {
    const out = join(dir, 'x', 'ci.json');
    expect(main(['collect', '--out', out], ENV, NOW)).toBe(0);
    expect(JSON.parse(readFileSync(out, 'utf-8')).shaShort).toBe('abcdef0');
  });

  it('main index writes the landing page', () => {
    const out = join(dir, 'index.html');
    expect(main(['index', '--out', out, '--mutation'], ENV, NOW)).toBe(0);
    expect(readFileSync(out, 'utf-8')).toContain('href="mutation/"');
  });
});

describe('mutation-summary --json', () => {
  const many = (status: string, n: number) => Array.from({ length: n }, () => ({ status }));

  function run(extra: string[], env: Record<string, string> = {}) {
    const report = join(dir, 'mutation.json');
    const mutants = [
      ...many('Killed', 6),
      ...many('Timeout', 1),
      ...many('Survived', 2),
      ...many('NoCoverage', 1),
      ...many('CompileError', 4),
      ...many('Ignored', 3),
    ];
    writeFileSync(report, JSON.stringify({ files: { 'src/a.ts': { mutants } } }));
    const json = join(dir, 'out', 'mutation-status.json');
    const code = mutationMain(['--report', report, '--json', json, ...extra], env, NOW);
    return { code, status: JSON.parse(readFileSync(json, 'utf-8')) };
  }

  it('writes the score, the counts, the baseline, the time and the commit', () => {
    const { code, status } = run(['--break', '77'], { GITHUB_SHA: 'deadbeef' });
    expect(code).toBe(0);
    expect(status).toEqual({
      score: 70,
      killed: 6,
      survived: 2,
      timeout: 1,
      noCoverage: 1,
      errors: 4,
      total: 10,
      baseline: 77,
      belowBaseline: true,
      finishedAt: '2026-11-11T14:05:59.000Z',
      sha: 'deadbeef',
    });
  });

  it('has a null baseline and belowBaseline without --break, and a null sha without the variable', () => {
    const { status } = run([]);
    expect(status).toMatchObject({ baseline: null, belowBaseline: null, sha: null });
  });

  it('says held when the score reaches the baseline', () => {
    expect(run(['--break', '70']).status).toMatchObject({ baseline: 70, belowBaseline: false });
  });
});

describe('the workflows', () => {
  const read = (name: string) =>
    readFileSync(join(ROOT, '.github', 'workflows', name), 'utf-8').replace(/\r\n/g, '\n');
  const pages = read('pages.yml');
  const mutation = read('mutation.yml');
  const ci = read('ci.yml');

  it('pages.yml runs after CI and Mutation testing on main, and on demand', () => {
    expect(pages).toMatch(
      /workflow_run:\n\s+workflows: \[CI, Mutation testing\]\n\s+types: \[completed\]\n\s+branches: \[main\]/,
    );
    expect(pages).toContain('workflow_dispatch:');
    expect(ci).toMatch(/^name: CI$/m);
    expect(mutation).toMatch(/^name: Mutation testing$/m);
  });

  it('pages.yml has the four permissions and the pages concurrency group', () => {
    expect(pages).toMatch(
      /^permissions:\n {2}contents: read\n {2}actions: read\n {2}pages: write\n {2}id-token: write\n/m,
    );
    expect(pages).toMatch(/^concurrency:\n {2}group: pages\n {2}cancel-in-progress: false\n/m);
  });

  it('pages.yml deploys, and only from the default branch', () => {
    expect(pages).toContain('actions/deploy-pages@');
    expect(pages).toContain('actions/upload-pages-artifact@');
    expect(pages).toContain(
      "github.ref == format('refs/heads/{0}', github.event.repository.default_branch)",
    );
  });

  it('no script line in pages.yml contains an expression', () => {
    const lines = pages.split('\n');
    const scripts: string[] = [];
    lines.forEach((line, index) => {
      const match = /^(\s*)(?:- )?run:(.*)$/.exec(line);
      if (!match) return;
      scripts.push(match[2] ?? '');
      const indent = (match[1] ?? '').length;
      for (let next = index + 1; next < lines.length; next++) {
        const text = lines[next] ?? '';
        if (text.trim() !== '' && text.length - text.trimStart().length <= indent) break;
        scripts.push(text);
      }
    });
    expect(scripts.length).toBeGreaterThan(5);
    expect(scripts.filter((line) => line.includes('${{'))).toEqual([]);
  });

  it('pages.yml takes only pushes for CI, skips cancelled runs, and only scheduled or manual mutation runs', () => {
    expect(pages).toContain('find_run ci.yml ci-status "--event push --status completed" 20');
    expect(pages).toContain('select(.conclusion != "cancelled")');
    expect(pages).toContain('--json databaseId,conclusion,event --jq "$5"');
    expect(pages).toContain('select(.event == "schedule" or .event == "workflow_dispatch")');
  });

  it('pages.yml does not deploy for a run caused by a pull request', () => {
    expect(pages).toContain(
      "github.event_name == 'workflow_dispatch' || github.event.workflow_run.event != 'pull_request'",
    );
    expect(pages).toMatch(/if: \(.*pull_request'\) && github\.ref == format\(/);
  });

  it('mutation.yml no longer deploys', () => {
    expect(mutation).not.toContain('deploy-pages');
    expect(mutation).not.toContain('upload-pages-artifact');
    expect(mutation).not.toMatch(/^ {2}pages:$/m);
  });

  it('mutation.yml uploads mutation-site with the JSON status, and baseline needs report', () => {
    expect(mutation).toMatch(/name: mutation-site\n\s+path: site\/\n\s+retention-days: 90/);
    expect(mutation).toContain('--json site/mutation-status.json');
    expect(mutation).toMatch(/\n {2}baseline:\n(?: {4}.*\n)*? {4}needs: report\n/);
  });

  it('ci.yml collects and uploads ci-status even when the gate failed', () => {
    expect(ci).toMatch(
      /if: always\(\)\n\s+run: node tools\/status-card\.mjs collect --out status\/ci-status\.json/,
    );
    expect(ci).toMatch(
      /if: always\(\)\n\s+uses: actions\/upload-artifact@\S+ # \S+\n\s+with:\n\s+name: ci-status\n\s+path: status\/ci-status\.json\n\s+retention-days: 90/,
    );
  });

  it('only pages.yml deploys', () => {
    expect(ci).not.toContain('deploy-pages');
    expect(ci).not.toContain('upload-pages-artifact');
  });
});
