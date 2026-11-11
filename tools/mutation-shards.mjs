// Splits the mutate set of stryker.config.mjs into shards, so the mutation run can be spread over
// several CI jobs (a single job would exceed GitHub's 6 h limit). Plain Node, no dependencies.
//
//   node tools/mutation-shards.mjs [N]    # prints the shard sizes (default 24 shards)
//
// This module also owns the mutate list: stryker.config.mjs imports it, so the files a shard
// lists and the files Stryker mutates cannot drift apart.
import { globSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DEFAULT_SHARDS = 24;

export const INCLUDE = ['src/**/*.{ts,tsx}'];

export const EXCLUDE = [
  // Tests and their helpers (fixtures, fakes, setup) are not product code.
  'src/**/*.test.{ts,tsx}',
  'src/test/**',
  // Generated from the OpenAPI specification (npm run generate:api).
  'src/api/generated/**',
  'src/**/*.d.ts',
  // Wiring that only starts the app: polyfill imports and the root render. The E2E suite covers
  // them; a unit test would only restate the wiring.
  'src/polyfills.ts',
  'src/main.tsx',
  // Two constants (the app and service IDs). tests/service/proxy.test.ts reads its source text to
  // pin the app ID, which instrumentation would rewrite, and there is no logic to mutate.
  'src/platform/webos/serviceFetch.ts',
];

/** The same list in Stryker's `mutate` syntax: globs, with `!` for the exclusions. */
export const MUTATE = [...INCLUDE, ...EXCLUDE.map((pattern) => `!${pattern}`)];

/**
 * Parses "k/N" (1-based). Throws on anything else: a shard that silently fell back to the whole
 * set would run for days.
 * @returns {{ index: number, count: number }}
 */
export function parseShard(value) {
  const match = /^(\d+)\/(\d+)$/.exec(String(value ?? '').trim());
  const index = match ? Number(match[1]) : NaN;
  const count = match ? Number(match[2]) : NaN;
  if (!match || count < 1 || index < 1 || index > count) {
    throw new Error(
      `Invalid shard "${value}": expected "k/N" with 1 <= k <= N (for example "3/24").`,
    );
  }
  return { index, count };
}

/** The files of the mutate set, sorted, with forward slashes, relative to `cwd`. */
export function listMutateFiles(cwd = process.cwd()) {
  return globSync(INCLUDE, { cwd, exclude: EXCLUDE })
    .map((file) => file.replaceAll('\\', '/'))
    .sort();
}

export function withSizes(files, cwd = process.cwd()) {
  return files.map((path) => ({ path, size: statSync(`${cwd}/${path}`).size }));
}

/**
 * Greedy bin packing by size: largest file first, onto the shard with the smallest total so far,
 * ties by the lower shard number (and equal sizes by path). Deterministic for the same input.
 * The file size stands in for the number of mutants, which grows with the amount of code.
 * @param {Array<{ path: string, size: number }>} files
 * @returns {Array<{ files: string[], size: number }>} one entry per shard, shard 1 first
 */
export function assignShards(files, count) {
  const shards = Array.from({ length: count }, () => ({ files: [], size: 0 }));
  const bySize = [...files].sort((a, b) => b.size - a.size || (a.path < b.path ? -1 : 1));
  for (const file of bySize) {
    let target = shards[0];
    for (const shard of shards) if (shard.size < target.size) target = shard;
    target.files.push(file.path);
    target.size += file.size;
  }
  for (const shard of shards) shard.files.sort();
  return shards;
}

/**
 * The files of shard "k/N". Throws when the shard is empty (more shards than files): Stryker
 * with an empty `mutate` list would do a plain test run, and with no list at all the whole set.
 */
export function filesOfShard(value, cwd = process.cwd()) {
  const { index, count } = parseShard(value);
  const shard = assignShards(withSizes(listMutateFiles(cwd), cwd), count)[index - 1];
  if (!shard || shard.files.length === 0) {
    throw new Error(`Shard ${index}/${count} has no files: there are fewer files than shards.`);
  }
  return shard.files;
}

function main(argv) {
  const count = argv[0] ? Number(argv[0]) : DEFAULT_SHARDS;
  const shards = assignShards(withSizes(listMutateFiles()), count);
  console.log('Shard  Files  Bytes');
  shards.forEach((shard, i) => {
    console.log(
      `${String(i + 1).padStart(5)}  ${String(shard.files.length).padStart(5)}  ${shard.size}`,
    );
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
