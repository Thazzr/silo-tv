// Builds, checks, packages and installs the app on a webOS TV, then launches it.
// The device name comes from WEBOS_DEVICE (default "tv"); it must exist in ares-setup-device.
// When SILO_SERVER is set, it is passed to the app as the launch parameter "server".
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const device = process.env.WEBOS_DEVICE || 'tv';
const server = process.env.SILO_SERVER;
const appId = 'io.github.thazzr.silolg';
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'));
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
if (server) launchArgs.push('--params', JSON.stringify({ server }));
launchArgs.push(appId);

// These mirror the npm scripts "build", "check:bundle" and "package" without going through npm.
run('vite build', resolve(root, 'node_modules', 'vite', 'bin', 'vite.js'), ['build']);
run('check-bundle', resolve(root, 'scripts', 'check-bundle.mjs'), []);
run('ares-package', resolve(aresBin, 'ares-package.js'), ['dist', 'service', '-o', 'out', '-n']);
run('ares-install', resolve(aresBin, 'ares-install.js'), ['-d', device, ipk]);
run('ares-launch', resolve(aresBin, 'ares-launch.js'), launchArgs);
