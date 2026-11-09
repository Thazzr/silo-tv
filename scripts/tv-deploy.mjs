// Builds, checks, packages and installs the app on a webOS TV, then launches it.
// The device name comes from WEBOS_DEVICE (default "tv"); it must exist in ares-setup-device.
// Launch parameters come from the environment (see scripts/launch-params.mjs): SILO_SERVER, PROBE=1,
// TRANSPORT=direct|service. Only what is set is passed.
// PERF_BUILD=1 builds with `vite build --mode perf` and ships dist-perf (readable function names for
// npm run tv:profile) instead of dist.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBuild } from './deploy-build.mjs';
import { buildLaunchParams } from './launch-params.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const device = process.env.WEBOS_DEVICE || 'tv';
const appId = 'io.github.thazzr.silotv';
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'));
const build = resolveBuild(process.env);
const ipk = `out/${appId}_${version}_all.ipk`;
const aresBin = resolve(root, 'node_modules', '@webos-tools', 'cli', 'bin');

// Every step runs the entry point through node with an argument array and no shell, so JSON
// launch params need no quoting.
function run(label, script, args) {
  console.log(`> ${label} ${args.join(' ')}`);
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`Step failed: ${label} ${args.join(' ')}`);
    process.exit(result.status ?? 1);
  }
}

const launchArgs = ['-d', device];
const params = buildLaunchParams(process.env);
if (Object.keys(params).length > 0) launchArgs.push('--params', JSON.stringify(params));
launchArgs.push(appId);

// These mirror the npm scripts "build", "check:bundle" and "package" without going through npm.
run('vite build', resolve(root, 'node_modules', 'vite', 'bin', 'vite.js'), build.viteArgs);
// check-bundle inspects dist/ only; the unminified perf build is a profiling aid, not a release.
if (!build.perf) run('check-bundle', resolve(root, 'scripts', 'check-bundle.mjs'), []);
run('ares-package', resolve(aresBin, 'ares-package.js'), [
  build.distDir,
  'service',
  '-o',
  'out',
  '-n',
]);
run('ares-install', resolve(aresBin, 'ares-install.js'), ['-d', device, ipk]);
run('ares-launch', resolve(aresBin, 'ares-launch.js'), launchArgs);

console.log('\nLaunched. To read the probe results from the TV, run: npm run tv:eval');
