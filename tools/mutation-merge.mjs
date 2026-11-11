// Merges the JSON reports of the mutation shards into one report and one HTML page. Plain Node,
// no dependencies.
//
//   node tools/mutation-merge.mjs --out <dir> [--expect N] [--shard k/N] [--no-html] <report|dir>...
//
// Writes <dir>/mutation.json (one schema-valid report, usable as Stryker's incremental file) and
// <dir>/index.html with a copy of mutation-test-elements.js next to it. A directory argument is
// searched for *.json files.
//
// --expect N   exit non-zero unless N readable reports are given, so a partial run never
//              publishes a total score. Without it, an unreadable report is skipped with a warning.
// --shard k/N  keep only the files of that shard. A shard's own report also carries the cached
//              results of every other shard's files (Stryker keeps them in its incremental file),
//              which would show up twice in the merge.
// --no-html    only the JSON.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { filesOfShard } from './mutation-shards.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ELEMENTS_FILE = 'mutation-test-elements.js';
const ELEMENTS_SOURCE = join(
  ROOT,
  'node_modules',
  'mutation-testing-elements',
  'dist',
  ELEMENTS_FILE,
);

const testKey = (path, test) =>
  JSON.stringify([
    path,
    test.name,
    test.location?.start?.line ?? null,
    test.location?.start?.column ?? null,
  ]);

/**
 * Merges reports into one. Mutant and test ids are only unique within one report, so both are
 * renumbered; tests are united by (file, name, location) and a mutant's `coveredBy`/`killedBy`
 * follow. A source file present in two reports is an error.
 */
export function mergeReports(reports) {
  if (reports.length === 0) throw new Error('No reports to merge.');
  const first = reports[0];
  const files = {};
  const testFiles = {};
  const testIds = new Map(); // key -> new id
  let nextTest = 0;
  let nextMutant = 0;

  for (const report of reports) {
    const idMap = new Map(); // old test id -> new id, for this report
    for (const [path, testFile] of Object.entries(report.testFiles ?? {})) {
      const target = (testFiles[path] ??= { tests: [] });
      if (testFile.source !== undefined && target.source === undefined)
        target.source = testFile.source;
      for (const test of testFile.tests ?? []) {
        const key = testKey(path, test);
        let id = testIds.get(key);
        if (id === undefined) {
          id = String(nextTest++);
          testIds.set(key, id);
          target.tests.push({ ...test, id });
        }
        idMap.set(test.id, id);
      }
    }
    const remap = (ids) => (ids ?? []).map((id) => idMap.get(id)).filter((id) => id !== undefined);
    for (const [path, file] of Object.entries(report.files ?? {})) {
      if (Object.hasOwn(files, path)) {
        throw new Error(`File ${path} is in more than one report; the shards must not overlap.`);
      }
      files[path] = {
        ...file,
        mutants: (file.mutants ?? []).map((mutant) => {
          const merged = { ...mutant, id: String(nextMutant++) };
          if (mutant.coveredBy) merged.coveredBy = remap(mutant.coveredBy);
          if (mutant.killedBy) merged.killedBy = remap(mutant.killedBy);
          return merged;
        }),
      };
    }
  }

  return {
    schemaVersion: first.schemaVersion,
    thresholds: first.thresholds,
    projectRoot: first.projectRoot,
    files,
    testFiles,
  };
}

/** Keeps only the listed source files. */
export function restrictReport(report, keep) {
  const wanted = new Set(keep);
  return {
    ...report,
    files: Object.fromEntries(
      Object.entries(report.files ?? {}).filter(([path]) => wanted.has(path)),
    ),
  };
}

/** JSON that is safe inside a <script> element: no "</script>" or "<!--" can end or confuse it. */
export function escapeForScript(json) {
  const escape = (c) =>
    String.fromCharCode(92) + 'u' + c.charCodeAt(0).toString(16).padStart(4, '0');
  // U+2028/U+2029 are line terminators in older JavaScript string literals.
  const unsafe = new RegExp('[<' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');
  return json.replace(unsafe, escape);
}

export function renderHtml(report) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Mutation report</title>
    <script src="${ELEMENTS_FILE}"></script>
  </head>
  <body>
    <mutation-test-report-app title-postfix="Mutation report"></mutation-test-report-app>
    <script>
      document.querySelector('mutation-test-report-app').report = ${escapeForScript(JSON.stringify(report))};
    </script>
  </body>
</html>
`;
}

/** Expands directories (recursively) into their *.json files; the rest stays as given. */
export function expandInputs(inputs) {
  const result = [];
  const visit = (path) => {
    if (existsSync(path) && statSync(path).isDirectory()) {
      for (const entry of readdirSync(path).sort()) visit(join(path, entry));
    } else if (!existsSync(path) || path.endsWith('.json')) {
      result.push(path);
    }
  };
  inputs.forEach(visit);
  return result;
}

function readReport(path) {
  const report = JSON.parse(readFileSync(path, 'utf-8'));
  if (typeof report !== 'object' || report === null || typeof report.files !== 'object') {
    throw new Error('not a mutation report (no "files")');
  }
  return report;
}

function parseArgs(argv) {
  const options = { out: '', expect: 0, shard: '', html: true, inputs: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--out') options.out = argv[++i] ?? '';
    else if (arg === '--expect') options.expect = Number(argv[++i]);
    else if (arg === '--shard') options.shard = argv[++i] ?? '';
    else if (arg === '--no-html') options.html = false;
    else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}`);
    else options.inputs.push(arg);
  }
  if (!options.out) throw new Error('--out <dir> is required.');
  if (!Number.isInteger(options.expect) || options.expect < 0) {
    throw new Error('--expect needs a whole number.');
  }
  return options;
}

export function main(argv = process.argv.slice(2), elementsSource = ELEMENTS_SOURCE) {
  const options = parseArgs(argv);
  const paths = expandInputs(options.inputs);
  const reports = [];
  for (const path of paths) {
    try {
      reports.push(readReport(path));
    } catch (error) {
      if (options.expect)
        throw new Error(`Cannot read ${path}: ${error.message}`, { cause: error });
      console.warn(`mutation-merge: skipping ${path}: ${error.message}`);
    }
  }
  if (options.expect && reports.length < options.expect) {
    throw new Error(`Expected ${options.expect} shard reports, got ${reports.length}.`);
  }
  const shardFiles = options.shard ? filesOfShard(options.shard) : null;
  const kept = shardFiles ? reports.map((report) => restrictReport(report, shardFiles)) : reports;
  const merged = mergeReports(kept);

  mkdirSync(options.out, { recursive: true });
  writeFileSync(join(options.out, 'mutation.json'), JSON.stringify(merged));
  if (options.html) {
    writeFileSync(join(options.out, 'index.html'), renderHtml(merged));
    copyFileSync(elementsSource, join(options.out, ELEMENTS_FILE));
  }
  console.log(
    `mutation-merge: ${reports.length} report(s), ${Object.keys(merged.files).length} file(s) -> ${options.out}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`mutation-merge: ${error?.message ?? error}`);
    process.exitCode = 1;
  }
}
