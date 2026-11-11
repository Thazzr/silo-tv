// Turns Stryker's JSON report (reports/mutation/mutation.json) into the CI job summary and the
// shields.io endpoint file for the badge. Plain Node, no dependencies.
//
//   node tools/mutation-summary.mjs [--report <file>] [--badge <file>]
//
// The summary is appended to $GITHUB_STEP_SUMMARY, or printed without it. Unlike ci-summary.mjs this
// one exits non-zero when the report is missing or unreadable: the badge and the published site
// must not be built from nothing.
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

export function buildSummary({ total, files }) {
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

export function main(argv = process.argv.slice(2), env = process.env) {
  const report = JSON.parse(readFileSync(option(argv, '--report', DEFAULT_REPORT), 'utf-8'));
  const result = analyze(report);
  const markdown = buildSummary(result);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  else console.log(markdown);
  const badge = option(argv, '--badge', '');
  if (badge) {
    mkdirSync(dirname(badge), { recursive: true });
    writeFileSync(badge, `${JSON.stringify(buildBadge(result.total.score))}\n`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`mutation-summary: ${error?.message ?? error}`);
    process.exitCode = 1;
  }
}
