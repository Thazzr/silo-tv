// Turns Stryker's JSON report (reports/mutation/mutation.json) into the CI job summary and the
// shields.io endpoint file for the badge. Plain Node, no dependencies.
//
//   node tools/mutation-summary.mjs [--report <file>] [--badge <file>] [--json <file>] [--break <percent>]
//   node tools/mutation-summary.mjs --check <score> --break <percent>
//
// The summary is appended to $GITHUB_STEP_SUMMARY, or printed without it. Unlike ci-summary.mjs this
// one exits non-zero when the report is missing or unreadable: the badge and the published site
// must not be built from nothing.
//
// --break names the baseline. The summary run only reports against it (and writes score= and
// below_break= to $GITHUB_OUTPUT); it still exits 0 on a valid report. --check is the separate
// step that fails the workflow: exit 1 below the baseline, 2 for an invalid --break. Stryker's own
// thresholds.break would apply to every shard separately, so the baseline is held on the merged
// score instead.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_REPORT = 'reports/mutation/mutation.json';
// The same thresholds as stryker.config.mjs: at or above `high` is green, below `low` is red.
export const HIGH = 80;
export const LOW = 60;
const WORST_FILES = 10;

/**
 * Stryker's own definition: detected = killed + timeout; undetected = survived + no coverage.
 * Compile errors, runtime errors and ignored mutants are not part of the score.
 */
export function tally(mutants) {
  const counts = {
    killed: 0,
    survived: 0,
    timeout: 0,
    noCoverage: 0,
    errors: 0,
    ignored: 0,
    pending: 0,
  };
  for (const { status } of mutants) {
    if (status === 'Killed') counts.killed++;
    else if (status === 'Survived') counts.survived++;
    else if (status === 'Timeout') counts.timeout++;
    else if (status === 'NoCoverage') counts.noCoverage++;
    else if (status === 'CompileError' || status === 'RuntimeError') counts.errors++;
    else if (status === 'Ignored') counts.ignored++;
    else counts.pending++;
  }
  const detected = counts.killed + counts.timeout;
  const valid = detected + counts.survived + counts.noCoverage;
  return { ...counts, score: valid === 0 ? null : (detected / valid) * 100 };
}

/** @returns {{ total: ReturnType<typeof tally>, files: Array<{ path: string } & ReturnType<typeof tally>> }} */
export function analyze(report) {
  const files = Object.entries(report.files ?? {}).map(([path, file]) => ({
    path,
    ...tally(file.mutants ?? []),
  }));
  return {
    total: tally(Object.values(report.files ?? {}).flatMap((file) => file.mutants ?? [])),
    files,
  };
}

const formatScore = (score) => (score === null ? 'n/a' : `${score.toFixed(1)} %`);

export function badgeColor(score) {
  if (score === null) return 'lightgrey';
  if (score >= HIGH) return 'brightgreen';
  if (score >= LOW) return 'yellow';
  return 'red';
}

/** The shields.io endpoint format: https://shields.io/badges/endpoint-badge */
export function buildBadge(score) {
  return {
    schemaVersion: 1,
    label: 'mutation score',
    message: formatScore(score),
    color: badgeColor(score),
  };
}

export function buildSummary({ total, files }, baseline = null) {
  // Files without a single valid mutant have no score to rank.
  const worst = files
    .filter((file) => file.score !== null)
    .sort((a, b) => a.score - b.score || b.survived + b.noCoverage - (a.survived + a.noCoverage))
    .slice(0, WORST_FILES);
  return [
    '# Mutation testing',
    '',
    `Mutation score: **${formatScore(total.score)}**`,
    '',
    ...(baseline
      ? [
          `Baseline: ${formatScore(baseline.value)}, ${baseline.below ? 'this run is below it' : 'held'}.`,
          '',
        ]
      : []),
    '| Killed | Survived | Timeout | No coverage | Errors |',
    '|---:|---:|---:|---:|---:|',
    `| ${total.killed} | ${total.survived} | ${total.timeout} | ${total.noCoverage} | ${total.errors} |`,
    '',
    `## The ${WORST_FILES} files with the lowest score`,
    '',
    ...(worst.length === 0
      ? ['No file has a score.']
      : [
          '| File | Score | Survived | No coverage |',
          '|---|---:|---:|---:|',
          ...worst.map(
            (file) =>
              `| \`${file.path}\` | ${formatScore(file.score)} | ${file.survived} | ${file.noCoverage} |`,
          ),
        ]),
    '',
  ].join('\n');
}

function option(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

const NUMBER = /^\d+(\.\d+)?$/;

/**
 * The baseline from --break: `null` without the option, `NaN` for an invalid value (not a number,
 * outside 0 to 100, or missing).
 */
export function parseBreak(argv) {
  const index = argv.indexOf('--break');
  if (index < 0) return null;
  const raw = argv[index + 1];
  if (typeof raw !== 'string' || !NUMBER.test(raw)) return Number.NaN;
  const value = Number(raw);
  return value >= 0 && value <= 100 ? value : Number.NaN;
}

/** The score as the workflow passes it around: one decimal, so the check sees what the badge shows. */
const rounded = (score) => (score === null ? null : Number(score.toFixed(1)));

/**
 * The record for the status card (tools/status-card.mjs). `total` is the number of mutants the score
 * is taken over (killed, survived, timeout, no coverage); errors and ignored ones are outside it.
 */
function buildStatus(tally, score, baseline, below, env, now) {
  return {
    score,
    killed: tally.killed,
    survived: tally.survived,
    timeout: tally.timeout,
    noCoverage: tally.noCoverage,
    errors: tally.errors,
    total: tally.killed + tally.survived + tally.timeout + tally.noCoverage,
    baseline,
    belowBaseline: baseline === null ? null : below,
    finishedAt: now.toISOString(),
    sha: env.GITHUB_SHA ?? null,
  };
}

function usageError(message) {
  console.error(`mutation-summary: ${message}`);
  return 2;
}

/** --check <score> --break <percent>: reads no report, writes no summary or badge. */
function check(argv, baseline) {
  const raw = argv[argv.indexOf('--check') + 1] ?? '';
  if (!NUMBER.test(raw)) {
    console.log('::error::No mutation score to check.');
    return 1;
  }
  const score = rounded(Number(raw));
  if (score >= baseline) return 0;
  console.log(
    `::error::Mutation score ${formatScore(score)} is below the baseline of ${formatScore(baseline)}.`,
  );
  return 1;
}

/** @returns {number} the exit code: 0, 1 below the baseline in --check mode, 2 for a usage error. */
export function main(argv = process.argv.slice(2), env = process.env, now = new Date()) {
  const baseline = parseBreak(argv);
  if (Number.isNaN(baseline)) return usageError('--break needs a number from 0 to 100');
  if (argv.includes('--check')) {
    if (baseline === null) return usageError('--check needs --break');
    return check(argv, baseline);
  }
  const report = JSON.parse(readFileSync(option(argv, '--report', DEFAULT_REPORT), 'utf-8'));
  const result = analyze(report);
  const score = rounded(result.total.score);
  const below = baseline !== null && (score === null || score < baseline);
  const markdown = buildSummary(result, baseline === null ? null : { value: baseline, below });
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  else console.log(markdown);
  const badge = option(argv, '--badge', '');
  if (badge) {
    mkdirSync(dirname(badge), { recursive: true });
    writeFileSync(badge, `${JSON.stringify(buildBadge(result.total.score))}\n`);
  }
  const json = option(argv, '--json', '');
  if (json) {
    mkdirSync(dirname(json), { recursive: true });
    writeFileSync(
      json,
      `${JSON.stringify(buildStatus(result.total, score, baseline, below, env, now))}\n`,
    );
  }
  if (env.GITHUB_OUTPUT) {
    const lines = [`score=${score === null ? '' : score.toFixed(1)}`];
    if (baseline !== null) lines.push(`below_break=${below}`);
    appendFileSync(env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`mutation-summary: ${error?.message ?? error}`);
    process.exitCode = 1;
  }
}
