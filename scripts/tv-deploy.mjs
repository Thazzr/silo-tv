// Builds, checks, packages and installs the app on a webOS TV, then launches it.
// The device name comes from WEBOS_DEVICE (default "tv"); it must exist in ares-setup-device.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const device = process.env.WEBOS_DEVICE || 'tv';
const appId = 'io.github.thazzr.silolg';
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'));
const ipk = `out/${appId}_${version}_all.ipk`;

function run(command, args) {
  console.log(`> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    // npm/npx are .cmd shims on Windows and need a shell.
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    console.error(`Step failed: ${command} ${args.join(' ')}`);
    process.exit(result.status ?? 1);
  }
}

run('npm', ['run', 'build']);
run('npm', ['run', 'check:bundle']);
run('npm', ['run', 'package']);
run('npx', ['ares-install', '-d', device, ipk]);
run('npx', ['ares-launch', '-d', device, appId]);
