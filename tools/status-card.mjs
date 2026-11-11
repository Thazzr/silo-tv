// The test results card of the README: an SVG (light and dark) built from what the CI gate and the
// mutation run leave behind. Plain Node, no dependencies.
//
//   node tools/status-card.mjs collect --out status/ci-status.json
//   node tools/status-card.mjs render --ci <ci-status.json> --mutation <mutation-status.json> --out <dir>
//   node tools/status-card.mjs index --out <index.html> [--mutation]
//
// `collect` runs in the CI job and never fails: a missing file leaves its part null. `render` and
// `index` run in the Pages workflow (.github/workflows/pages.yml), which is the only deployer of the
// site; either input of `render` may be missing, and the card then says "no recent run" for it.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_FILES, parseGateTable, parseJunit } from './ci-summary.mjs';
import { HIGH, LOW } from './mutation-summary.mjs';

export const NO_RECENT_RUN = 'no recent run';
export const CARD_FILES = { light: 'test-results-light.svg', dark: 'test-results-dark.svg' };

const readText = (path) => {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
};

const readJson = (path) => {
  const text = path ? readText(path) : null;
  if (text === null) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------------------------
// collect

const ROW = /^(.+?)\s+(\S+)\s+(ok|failed|skipped)(?:\s+\((.*)\))?\s*$/;

/** The gate's step rows (name, time, result) in gate order; the header and total lines drop out. */
export function parseGateSteps(text) {
  const table = parseGateTable(text);
  if (!table) return null;
  const steps = [];
  for (const line of table) {
    const match = ROW.exec(line);
    if (match && match[1] !== 'Step') {
      steps.push({ name: match[1], time: match[2], result: match[3] });
    }
  }
  return steps.length > 0 ? steps : null;
}

function counts(text) {
  if (text === null) return null;
  const { total, passed, failed, skipped } = parseJunit(text);
  return { total, passed, failed, skipped };
}

function coverageOf(text) {
  if (text === null) return null;
  try {
    const total = JSON.parse(text).total;
    const pick = (key) => (typeof total?.[key]?.pct === 'number' ? total[key].pct : null);
    const result = {
      statements: pick('statements'),
      branches: pick('branches'),
      functions: pick('functions'),
      lines: pick('lines'),
    };
    return Object.values(result).every((value) => value === null) ? null : result;
  } catch {
    return null;
  }
}

/**
 * Reads the gate's report files and the GITHUB_* variables into the status record.
 * @param {typeof DEFAULT_FILES} files
 * @param {Record<string, string | undefined>} env
 * @param {Date} now
 */
export function collect(files = DEFAULT_FILES, env = process.env, now = new Date()) {
  const steps = parseGateSteps(readText(files.gate) ?? '');
  const sha = env.GITHUB_SHA ?? null;
  const url =
    env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
      ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
      : null;
  return {
    sha,
    shaShort: sha ? sha.slice(0, 7) : null,
    ref: env.GITHUB_REF_NAME ?? null,
    runUrl: url,
    finishedAt: now.toISOString(),
    steps,
    unit: counts(readText(files.unit)),
    e2e: counts(readText(files.e2e)),
    coverage: coverageOf(readText(files.coverage)),
    ok: steps === null ? null : steps.every((step) => step.result !== 'failed'),
  };
}

// ---------------------------------------------------------------------------------------------
// render

// GitHub's greens and reds; amber is the "yellow" band of the mutation badge (below HIGH, from LOW).
const THEMES = {
  dark: {
    background: '#0A0A0A',
    frame: 'rgba(255,255,255,0.12)',
    text: '#EDEDED',
    secondary: 'rgba(237,237,237,0.6)',
    pass: '#3FB950',
    fail: '#F85149',
    warn: '#D29922',
  },
  light: {
    background: '#FFFFFF',
    frame: '#D0D7DE',
    text: '#1F2328',
    secondary: '#59636E',
    pass: '#1A7F37',
    fail: '#CF222E',
    warn: '#9A6700',
  },
};

const FONT = '-apple-system, &quot;Segoe UI&quot;, Helvetica, Arial, sans-serif';

/** Escapes text for XML, and drops the control characters XML 1.0 does not allow at all. */
export function escapeXml(value) {
  return (
    String(value)
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  );
}

/** "2026-11-11 14:05 UTC", or null for a missing or invalid timestamp. */
export function formatDateTime(iso) {
  const time = typeof iso === 'string' ? new Date(iso) : null;
  if (!time || Number.isNaN(time.getTime())) return null;
  const text = time.toISOString();
  return `${text.slice(0, 10)} ${text.slice(11, 16)} UTC`;
}

const formatDate = (iso) => formatDateTime(iso)?.slice(0, 10) ?? null;

const percent = (value) => (typeof value === 'number' ? `${value.toFixed(1)} %` : 'n/a');

/** The test count tile: "3170 passed", or "3 failed of 3170". */
export function describeCounts(result) {
  const { total, passed, failed, skipped } = result;
  const sub = [];
  if (failed > 0) {
    sub.push(`${passed} passed`);
  } else {
    sub.push(`${total} tests`);
  }
  if (skipped > 0) sub.push(`${skipped} skipped`);
  return {
    value: failed > 0 ? `${failed} failed of ${total}` : `${passed} passed`,
    tone: failed > 0 ? 'fail' : total === 0 ? 'none' : 'pass',
    sub,
  };
}

function mutationTone(score) {
  if (score === null || score === undefined) return 'none';
  if (score >= HIGH) return 'pass';
  if (score >= LOW) return 'warn';
  return 'fail';
}

function describeMutation(mutation) {
  const score = typeof mutation.score === 'number' ? mutation.score : null;
  const sub = [];
  if (typeof mutation.baseline === 'number') {
    sub.push({
      text: `baseline ${mutation.baseline} %`,
      tone: mutation.belowBaseline ? 'fail' : 'none',
    });
  }
  const date = formatDate(mutation.finishedAt);
  if (date) sub.push({ text: date, tone: 'none' });
  return {
    value: score === null ? 'n/a' : `${score.toFixed(1)} %`,
    tone: mutationTone(score),
    sub,
  };
}

const TILE_Y = 66;
const TILE_H = 130;
const COLUMN_X = [32, 240, 448, 656];
const COLUMN_W = 192;

/** The main figure of a tile gets smaller as the text gets longer, so it stays inside the tile. */
const valueSize = (text) => (text.length <= 11 ? 28 : text.length <= 14 ? 22 : 18);

function tile(index, label, value, tone, subLines, theme) {
  const x = COLUMN_X[index];
  const colour = tone === 'none' ? theme.secondary : theme[tone];
  const parts = [
    `<rect x="${x}" y="${TILE_Y}" width="${COLUMN_W}" height="${TILE_H}" rx="10" fill="none" stroke="${theme.frame}"/>`,
    `<text x="${x + 14}" y="${TILE_Y + 24}" font-size="13" fill="${theme.secondary}">${escapeXml(label)}</text>`,
    `<text x="${x + 14}" y="${TILE_Y + 58}" font-size="${valueSize(value)}" font-weight="700" fill="${colour}">${escapeXml(value)}</text>`,
  ];
  subLines.forEach((sub, line) => {
    const fill = sub.tone && sub.tone !== 'none' ? theme[sub.tone] : theme.secondary;
    parts.push(
      `<text x="${x + 14}" y="${TILE_Y + 82 + line * 16}" font-size="12" fill="${fill}">${escapeXml(sub.text)}</text>`,
    );
  });
  return parts.join('');
}

const plain = (text) => ({ text, tone: 'none' });

function chip(index, step, theme) {
  const x = COLUMN_X[index % 4];
  const y = 214 + Math.floor(index / 4) * 40;
  const skipped = step.result === 'skipped';
  const passed = step.result === 'ok';
  const mark = passed ? '✓' : skipped ? '–' : '✗';
  const colour = passed ? theme.pass : skipped ? theme.secondary : theme.fail;
  return [
    `<rect x="${x}" y="${y}" width="${COLUMN_W}" height="30" rx="15" fill="none" stroke="${passed || skipped ? theme.frame : theme.fail}"/>`,
    `<text x="${x + 14}" y="${y + 20}" font-size="13" font-weight="700" fill="${colour}">${mark}</text>`,
    `<text x="${x + 30}" y="${y + 20}" font-size="12" fill="${theme.text}">${escapeXml(step.name)}</text>`,
    `<text x="${x + COLUMN_W - 12}" y="${y + 20}" font-size="12" text-anchor="end" fill="${theme.secondary}">${escapeXml(step.time)}</text>`,
  ].join('');
}

/**
 * The card as an SVG string.
 * @param {object | null} ci the record `collect` wrote, or null
 * @param {object | null} mutation the record mutation-summary.mjs --json wrote, or null
 * @param {'light' | 'dark'} variant
 */
export function renderCard(ci, mutation, variant) {
  const theme = THEMES[variant];
  const missing = (index, label) => tile(index, label, NO_RECENT_RUN, 'none', [], theme);
  const when = ci ? formatDateTime(ci.finishedAt) : null;
  const head = ci
    ? [ci.ref ?? 'main', ci.shaShort ? `@ ${ci.shaShort}` : null, when ? `· ${when}` : null]
        .filter(Boolean)
        .join(' ')
    : NO_RECENT_RUN;

  const tiles = [];
  tiles.push(
    ci?.unit
      ? (() => {
          const unit = describeCounts(ci.unit);
          return tile(0, 'Unit tests', unit.value, unit.tone, unit.sub.map(plain), theme);
        })()
      : missing(0, 'Unit tests'),
  );
  tiles.push(
    ci?.e2e
      ? (() => {
          const e2e = describeCounts(ci.e2e);
          return tile(1, 'E2E tests', e2e.value, e2e.tone, e2e.sub.map(plain), theme);
        })()
      : missing(1, 'E2E tests'),
  );
  const coverage = ci?.coverage;
  tiles.push(
    coverage
      ? tile(
          2,
          'Coverage (lines)',
          percent(coverage.lines),
          'none',
          [
            plain(`statements ${percent(coverage.statements)}`),
            plain(`branches ${percent(coverage.branches)}`),
            plain(`functions ${percent(coverage.functions)}`),
          ],
          theme,
        )
      : missing(2, 'Coverage'),
  );
  tiles.push(
    mutation
      ? (() => {
          const view = describeMutation(mutation);
          return tile(3, 'Mutation score', view.value, view.tone, view.sub, theme);
        })()
      : missing(3, 'Mutation score'),
  );

  const steps = ci?.steps?.length
    ? ci.steps.map((step, index) => chip(index, step, theme)).join('')
    : `<text x="32" y="236" font-size="14" fill="${theme.secondary}">${NO_RECENT_RUN}</text>`;

  const label = `silo-tv test results, ${head}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="880" height="300" viewBox="0 0 880 300" role="img" aria-label="${escapeXml(label)}" font-family="${FONT}">
<title>${escapeXml(label)}</title>
<rect x="0.5" y="0.5" width="879" height="299" rx="14" fill="${theme.background}" stroke="${theme.frame}"/>
<text x="32" y="42" font-size="20" font-weight="700" fill="${theme.text}">silo-tv · test results</text>
<text x="848" y="42" font-size="14" text-anchor="end" fill="${theme.secondary}">${escapeXml(head)}</text>
${tiles.join('\n')}
${steps}
</svg>
`;
}

/** Writes both SVGs into `dir`. */
export function renderFiles(ci, mutation, dir) {
  mkdirSync(dir, { recursive: true });
  for (const variant of /** @type {const} */ (['light', 'dark'])) {
    writeFileSync(join(dir, CARD_FILES[variant]), renderCard(ci, mutation, variant));
  }
}

/** The landing page of the Pages site: the card, the mutation report (when there is one) and the CI runs. */
export function renderIndex({ repository, hasMutation }) {
  const runs = repository ? `https://github.com/${repository}/actions/workflows/ci.yml` : null;
  const links = [
    hasMutation ? '<li><a href="mutation/">Mutation testing report</a></li>' : null,
    runs ? `<li><a href="${escapeXml(runs)}">CI runs</a></li>` : null,
  ].filter(Boolean);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>silo-tv status</title>
</head>
<body>
<h1>silo-tv status</h1>
<p><img src="status/${CARD_FILES.light}" alt="Latest test results" width="880" height="300"></p>
<ul>
${links.join('\n')}
</ul>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------------------------
// command line

const option = (argv, name) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
};

/** @returns {number} the exit code: 0, or 2 for a usage error. */
export function main(argv = process.argv.slice(2), env = process.env, now = new Date()) {
  const [command] = argv;
  const out = option(argv, '--out');
  if (command === 'collect') {
    if (!out) return usage('collect needs --out <file>');
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(collect(DEFAULT_FILES, env, now), null, 2)}\n`);
    return 0;
  }
  if (command === 'render') {
    if (!out) return usage('render needs --out <dir>');
    renderFiles(readJson(option(argv, '--ci')), readJson(option(argv, '--mutation')), out);
    return 0;
  }
  if (command === 'index') {
    if (!out) return usage('index needs --out <file>');
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(
      out,
      renderIndex({ repository: env.GITHUB_REPOSITORY, hasMutation: argv.includes('--mutation') }),
    );
    return 0;
  }
  return usage('the command is collect, render or index');
}

function usage(message) {
  console.error(`status-card: ${message}`);
  return 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`status-card: ${error?.message ?? error}`);
    process.exitCode = 1;
  }
}
