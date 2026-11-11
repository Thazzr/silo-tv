// Project-wide mutation score (StrykerJS). Local: `npm run test:mutation` (add
// `-- --mutate "src/playback/session/**/*.ts,!src/**/*.test.ts"` to try one area first, or run one
// shard with `STRYKER_SHARD=3/24`). CI: .github/workflows/mutation.yml.

import { MUTATE, filesOfShard } from './tools/mutation-shards.mjs';

// vite.config.ts switches reporters and coverage on when CI is set (GitHub Actions sets it). The
// Vitest runner must not inherit that: coverage instrumentation slows every mutant down and the
// JUnit file is of no use here. The worker processes inherit this environment from this process.
process.env.CI = '';
// vite.config.ts then runs only the tests under src/, the ones that cover the mutated code. The tests
// under tools/, scripts/, build/ and tests/ cover other code, and some of them (process.chdir)
// cannot run in the runner's worker threads.
process.env.SILO_MUTATION = '1';

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  vitest: { configFile: 'vite.config.ts' },
  // Runs only the tests that cover a mutant, which is what makes a run over this many files feasible.
  coverageAnalysis: 'perTest',
  // The mutate list lives in tools/mutation-shards.mjs, next to the sharding that splits it.
  // STRYKER_SHARD=k/N runs only shard k of N (CI runs 24 shards in parallel); a malformed value
  // or an empty shard throws instead of running everything.
  mutate: process.env.STRYKER_SHARD ? filesOfShard(process.env.STRYKER_SHARD) : MUTATE,
  // Static mutants (top-level constants and the like) make a run slow and say little.
  ignoreStatic: true,
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  // CI keeps this file in the Actions cache, so a weekly run only re-tests what changed.
  incremental: true,
  incrementalFile: 'reports/mutation/stryker-incremental.json',
  // `break` stays null: Stryker would apply it to each of the CI shards separately, and their scores
  // differ widely. The baseline is held on the merged score by the workflow's MUTATION_BREAK
  // (.github/workflows/mutation.yml, checked by tools/mutation-summary.mjs --check).
  thresholds: { high: 80, low: 60, break: null },
  // GitHub's Linux runners have 4 cores. The tests render whole screens in jsdom and run on fake
  // timers, so the timeouts are generous: a mutant that makes a loop spin forever is still caught.
  concurrency: Number(process.env.STRYKER_CONCURRENCY) || 4,
  // The first run of the whole suite under instrumentation is slow; the default of 5 minutes timed out.
  dryRunTimeoutMinutes: 30,
  timeoutMS: 20_000,
  timeoutFactor: 2,
  tempDirName: 'reports/mutation/.stryker-tmp',
  cleanTempDir: true,
  // Stryker's own working copy and its reports are not part of the sandbox's inputs.
  ignorePatterns: [
    // Agent worktrees: whole copies of the repository, which would be copied into the sandbox.
    '.claude',
    'reports',
    'dist',
    'dist-perf',
    'out',
    'playwright-report',
    'test-results',
    'perf-results',
  ],
};
