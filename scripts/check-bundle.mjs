import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkDistFiles,
  checkHtml,
  checkNoServiceTests,
  checkServiceIds,
  checkVersions,
  serviceSourceFiles,
} from './bundle-checks.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const serviceDir = join(root, 'service');
const esCheckCli = join(root, 'node_modules', 'es-check', 'lib', 'cli', 'index.js');

function listFiles(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? listFiles(join(directory, entry.name), `${prefix}${entry.name}/`)
      : [`${prefix}${entry.name}`],
  );
}

if (!existsSync(dist)) {
  console.error('Bundle check failed: dist/ does not exist. Run "npm run build" first.');
  process.exit(1);
}

const violations = [];

function runEsCheck(label, paths) {
  try {
    // es-check treats its arguments as glob patterns, so Windows backslashes must become slashes.
    const targets = paths.map((path) => path.replaceAll('\\', '/'));
    execFileSync(process.execPath, [esCheckCli, 'es2019', ...targets], { stdio: 'pipe' });
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
    violations.push(`es-check es2019 failed for ${label}:\n${output}`);
  }
}

const files = listFiles(dist);
violations.push(...checkDistFiles(files));

const htmlPath = join(dist, 'index.html');
if (existsSync(htmlPath)) {
  violations.push(...checkHtml(readFileSync(htmlPath, 'utf-8')));
} else {
  violations.push('dist is missing index.html');
}

let appId;
const appinfoPath = join(dist, 'appinfo.json');
if (existsSync(appinfoPath)) {
  const appinfo = JSON.parse(readFileSync(appinfoPath, 'utf-8'));
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
  appId = appinfo.id;
  violations.push(...checkVersions(appinfo.version, pkg.version));
}

const jsFiles = files.filter((name) => name.endsWith('.js'));
if (jsFiles.length > 0) {
  runEsCheck(
    'dist',
    jsFiles.map((name) => join(dist, name)),
  );
}

// The JS service runs on the TV's own Node.js: ES2019 at most, and its ids must match the app id.
if (existsSync(serviceDir)) {
  const serviceFiles = listFiles(serviceDir);
  violations.push(...checkNoServiceTests(serviceFiles));
  const serviceJs = serviceSourceFiles(serviceFiles);
  if (serviceJs.length > 0) {
    runEsCheck(
      'service',
      serviceJs.map((name) => join(serviceDir, name)),
    );
  }
  if (appId !== undefined) {
    const readJson = (name) => JSON.parse(readFileSync(join(serviceDir, name), 'utf-8'));
    violations.push(...checkServiceIds(appId, readJson('services.json'), readJson('package.json')));
  }
} else {
  violations.push('service/ directory is missing');
}

if (violations.length > 0) {
  console.error('Bundle check failed:');
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}
console.log(`Bundle check passed (${files.length} files in dist, service checked).`);
