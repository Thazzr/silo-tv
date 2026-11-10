// Writes the CI job summary (GitHub Markdown) from the files the gate leaves behind when CI is set:
// the gate's table, the two JUnit files and the coverage summary. Plain Node, no dependencies.
//
//   node tools/ci-summary.mjs            # appends to $GITHUB_STEP_SUMMARY, or prints without it
//
// It never fails the job: a missing or unreadable file becomes a note in the summary, because a
// summary that crashes would hide the very failure it is there to show.
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DEFAULT_FILES = {
  gate: 'reports/gate.txt',
  unit: 'reports/vitest-junit.xml',
  e2e: 'reports/e2e-junit.xml',
  coverage: 'reports/coverage/coverage-summary.json',
};

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(text) {
  return text.replace(
    /&(?:#(\d+)|#x([0-9a-fA-F]+)|(amp|lt|gt|quot|apos));/g,
    (_m, dec, hex, named) =>
      named ? ENTITIES[named] : String.fromCodePoint(dec ? Number(dec) : parseInt(hex, 16)),
  );
}

function readAttribute(attributes, name) {
  const match = new RegExp(String.raw`(?:^|\s)${name}="([^"]*)"`).exec(attributes);
  return match ? decodeXml(match[1]) : '';
}

/**
 * Counts the test cases of a JUnit file. Counting the cases themselves (instead of trusting the
 * totals in the header) works for both Vitest's and Playwright's writer.
 * @returns {{ total: number, passed: number, failed: number, skipped: number, failedNames: string[] }}
 */
export function parseJunit(xml) {
  const result = { total: 0, passed: 0, failed: 0, skipped: 0, failedNames: [] };
  const testcase = /<testcase\b((?:[^>"']|"[^"]*"|'[^']*')*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  for (const match of xml.matchAll(testcase)) {
    const attributes = match[1] ?? '';
    const body = match[2] ?? '';
    const classname = readAttribute(attributes, 'classname');
    const name = readAttribute(attributes, 'name');
    result.total++;
    if (/<(?:failure|error)\b/.test(body)) {
      result.failed++;
      result.failedNames.push(classname && classname !== name ? `${classname} > ${name}` : name);
    } else if (/<skipped\b/.test(body)) {
      result.skipped++;
    } else {
      result.passed++;
    }
  }
  return result;
}

/** The gate's table: everything from the "==> summary" line on, or null when there is none. */
export function parseGateTable(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === '==> summary');
  if (start < 0) return null;
  const table = lines.slice(start + 1).filter((line) => line.trim() !== '');
  return table.length > 0 ? table : null;
}

const pct = (value) => (typeof value?.pct === 'number' ? `${value.pct}%` : 'n/a');

function section(title, body) {
  return [`## ${title}`, '', ...body, ''];
}

function gateSection(gate) {
  if (gate.error) return section('Gate', [`Not available: ${gate.error}.`]);
  const table = parseGateTable(gate.text);
  if (!table) return section('Gate', ['Not available: the gate printed no summary table.']);
  return section('Gate', ['```text', ...table, '```']);
}

function junitSection(title, junit) {
  if (junit.error) return section(title, [`Not available: ${junit.error}.`]);
  const totals = parseJunit(junit.text);
  const lines = [
    '| Total | Passed | Failed | Skipped |',
    '|---:|---:|---:|---:|',
    `| ${totals.total} | ${totals.passed} | ${totals.failed} | ${totals.skipped} |`,
  ];
  if (totals.total === 0) lines.push('', 'The report contains no test cases.');
  if (totals.failedNames.length > 0) {
    lines.push('', 'Failed tests:', '', ...totals.failedNames.map((name) => `- \`${name}\``));
  }
  return section(title, lines);
}

function coverageSection(coverage) {
  if (coverage.error) return section('Coverage', [`Not available: ${coverage.error}.`]);
  let total;
  try {
    total = JSON.parse(coverage.text).total;
  } catch {
    return section('Coverage', ['Not available: the coverage summary is not valid JSON.']);
  }
  if (!total) return section('Coverage', ['Not available: the coverage summary has no totals.']);
  return section('Coverage', [
    '| Statements | Branches | Functions | Lines |',
    '|---:|---:|---:|---:|',
    `| ${pct(total.statements)} | ${pct(total.branches)} | ${pct(total.functions)} | ${pct(total.lines)} |`,
  ]);
}

/**
 * @param {{ gate: Input, unit: Input, e2e: Input, coverage: Input }} inputs
 *   where Input is `{ text: string }` or `{ error: string }`
 */
export function buildSummary(inputs) {
  return [
    '# Verification gate',
    '',
    ...gateSection(inputs.gate),
    ...junitSection('Unit tests', inputs.unit),
    ...junitSection('E2E tests', inputs.e2e),
    ...coverageSection(inputs.coverage),
  ].join('\n');
}

function readInput(path) {
  try {
    return { text: readFileSync(path, 'utf-8') };
  } catch (error) {
    const reason = error?.code === 'ENOENT' ? 'file not found' : (error?.message ?? 'unreadable');
    return { error: `\`${path}\`: ${reason}` };
  }
}

/** Reads the files and returns the Markdown; never throws. */
export function summarize(files = DEFAULT_FILES) {
  return buildSummary({
    gate: readInput(files.gate),
    unit: readInput(files.unit),
    e2e: readInput(files.e2e),
    coverage: readInput(files.coverage),
  });
}

export function main(env = process.env) {
  const markdown = summarize();
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  } else {
    console.log(markdown);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    // Exit 0 on purpose: see the header.
    console.error(`ci-summary: ${error?.message ?? error}`);
  }
}
