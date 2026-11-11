// Release consistency check: node scripts/release-check.mjs <tag> [--root <dir>]
// Exits 0 only when the tag is "v" + a SemVer and every version in the repository equals it.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

const readJson = (root, path) => JSON.parse(readFileSync(join(root, path), 'utf-8'));

/** @returns {string[]} the mismatches; empty when the tag and all versions agree */
export function checkRelease(tag, root) {
  if (!tag || !tag.startsWith('v') || !SEMVER.test(tag.slice(1))) {
    return [`tag "${tag ?? ''}" is not "v" followed by a SemVer version (e.g. v0.3.0)`];
  }
  const version = tag.slice(1);
  const sources = [
    ['package.json', readJson(root, 'package.json').version],
    ['public/appinfo.json', readJson(root, 'public/appinfo.json').version],
    ['service/package.json', readJson(root, 'service/package.json').version],
    ['package-lock.json (root)', readJson(root, 'package-lock.json').version],
    [
      'package-lock.json (packages[""])',
      readJson(root, 'package-lock.json').packages?.['']?.version,
    ],
  ];
  return sources
    .filter(([, found]) => found !== version)
    .map(
      ([name, found]) => `${name} version is ${found ?? 'missing'}, tag ${tag} needs ${version}`,
    );
}

function main(argv) {
  const rootIndex = argv.indexOf('--root');
  const root = resolve(
    rootIndex === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : argv[rootIndex + 1],
  );
  const tag = argv.find((arg, index) => !arg.startsWith('--') && argv[index - 1] !== '--root');
  const problems = checkRelease(tag, root);
  if (problems.length > 0) {
    console.error('Release check failed:');
    for (const problem of problems) console.error(`  - ${problem}`);
    return 1;
  }
  console.log(`Release check ok: ${tag}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
