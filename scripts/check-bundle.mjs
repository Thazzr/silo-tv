import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDistFiles, checkHtml, checkVersions } from './bundle-checks.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

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
const files = listFiles(dist);
violations.push(...checkDistFiles(files));

const htmlPath = join(dist, 'index.html');
if (existsSync(htmlPath)) {
  violations.push(...checkHtml(readFileSync(htmlPath, 'utf-8')));
} else {
  violations.push('dist is missing index.html');
}

const appinfoPath = join(dist, 'appinfo.json');
if (existsSync(appinfoPath)) {
  const appinfo = JSON.parse(readFileSync(appinfoPath, 'utf-8'));
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
  violations.push(...checkVersions(appinfo.version, pkg.version));
}

const jsFiles = files.filter((name) => name.endsWith('.js'));
if (jsFiles.length > 0) {
  const esCheckCli = join(root, 'node_modules', 'es-check', 'lib', 'cli', 'index.js');
  try {
    // es-check treats its arguments as glob patterns, so Windows backslashes must become slashes.
    const targets = jsFiles.map((name) => join(dist, name).replaceAll('\\', '/'));
    execFileSync(process.execPath, [esCheckCli, 'es2019', ...targets], { stdio: 'pipe' });
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
    violations.push(`es-check es2019 failed:\n${output}`);
  }
}

if (violations.length > 0) {
  console.error('Bundle check failed:');
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}
console.log(`Bundle check passed (${files.length} files in dist).`);
