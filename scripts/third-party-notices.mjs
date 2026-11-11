// Writes the license notices of every bundled third-party package into one text file, and fails
// when a package's license is not compatible with the app's own (MPL-2.0).
//   node scripts/third-party-notices.mjs [--root <dir>] [--out <file>]
// The package set is the production closure of package.json (and service/package.json) resolved
// through package-lock.json and node_modules, the way Node resolves it. The lock file's `dev`
// flags are not used on their own: they are missing on some nested packages of dev tools.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ALLOWED_LICENSES = [
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'Apache-2.0',
  'MPL-2.0',
  'OFL-1.1',
  'CC0-1.0',
  'Unlicense',
];

const HEADER = `THIRD-PARTY NOTICES

silo-tv is licensed under the Mozilla Public License 2.0 (MPL-2.0).
Source code: https://github.com/Thazzr/silo-tv

This application includes the open-source packages listed below. Each one is
distributed under its own license, reproduced here as its license requires.
`;

/** True when an SPDX expression can be satisfied with allowed licenses only. */
export function isAllowedLicense(expression) {
  const cleaned = expression.replace(/[()]/g, ' ').trim();
  if (!cleaned) return false;
  return cleaned.split(/\s+OR\s+/i).some((alternative) =>
    alternative
      .trim()
      .split(/\s+AND\s+/i)
      .every((id) => ALLOWED_LICENSES.includes(id.trim())),
  );
}

function licenseOf(manifest) {
  if (typeof manifest.license === 'string') return manifest.license;
  if (manifest.license && typeof manifest.license.type === 'string') return manifest.license.type;
  if (Array.isArray(manifest.licenses)) {
    const types = manifest.licenses.map((entry) => entry?.type).filter(Boolean);
    if (types.length > 0) return types.join(' OR ');
  }
  return undefined;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/** Lock-file keys (`node_modules/a/node_modules/b`) of the production closure. */
function productionKeys(root, lock) {
  const packages = lock.packages ?? {};
  const rootManifests = [readJson(join(root, 'package.json'))];
  const servicePath = join(root, 'service', 'package.json');
  if (existsSync(servicePath)) rootManifests.push(readJson(servicePath));

  // The Node resolution walk: look in <parent>/node_modules, then in each ancestor's.
  const resolveFrom = (parentKey, name) => {
    let base = parentKey;
    for (;;) {
      const candidate = `${base ? `${base}/` : ''}node_modules/${name}`;
      if (packages[candidate]) return candidate;
      if (!base) return undefined;
      const cut = base.lastIndexOf('/node_modules/');
      base = cut === -1 ? '' : base.slice(0, cut);
    }
  };

  const seen = new Set();
  const visit = (parentKey, manifest, withPeers) => {
    const names = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
      // List more rather than fewer: peers that happen to be installed are listed too.
      ...(withPeers ? Object.keys(manifest.peerDependencies ?? {}) : []),
    ];
    for (const name of names) {
      const key = resolveFrom(parentKey, name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      visit(key, packages[key], true);
    }
  };
  for (const manifest of rootManifests) visit('', manifest, false);
  return [...seen];
}

function textFiles(directory) {
  const names = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  const pick = (pattern) => names.filter((name) => pattern.test(name)).sort();
  return {
    licenses: pick(/^(licen[cs]e|copying)([-._].*)?$/i),
    notices: pick(/^notice([-._].*)?$/i),
  };
}

/**
 * @returns {{ text: string, packages: { name: string, version: string, license: string, hasFile: boolean }[], problems: string[] }}
 */
export function buildNotices(root) {
  const lock = readJson(join(root, 'package-lock.json'));
  const problems = [];
  const blocks = [];
  for (const key of productionKeys(root, lock)) {
    const directory = join(root, ...key.split('/'));
    const manifestPath = join(directory, 'package.json');
    if (!existsSync(manifestPath)) {
      problems.push(`${key}: not installed (run npm ci)`);
      continue;
    }
    const manifest = readJson(manifestPath);
    const name = manifest.name ?? key.slice(key.lastIndexOf('node_modules/') + 13);
    const version = manifest.version ?? '?';
    const label = `${name}@${version}`;
    const license = licenseOf(manifest);
    if (!license) {
      problems.push(`${label}: no license field in package.json`);
      continue;
    }
    if (!isAllowedLicense(license)) {
      problems.push(
        `${label}: license "${license}" is not on the allowed list (MPL-2.0 compatible)`,
      );
      continue;
    }
    const { licenses, notices } = textFiles(directory);
    const lines = [`${name} ${version}`, `License: ${license}`, ''];
    if (licenses.length === 0) {
      lines.push(`License: ${license} (no license file in the package)`);
    }
    for (const file of licenses) {
      lines.push(readFileSync(join(directory, file), 'utf-8').trim(), '');
    }
    for (const file of notices) {
      lines.push('NOTICE:', readFileSync(join(directory, file), 'utf-8').trim(), '');
    }
    blocks.push({
      name,
      version,
      license,
      hasFile: licenses.length > 0,
      text: lines.join('\n').trimEnd(),
    });
  }
  blocks.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const rule = `\n\n${'='.repeat(78)}\n\n`;
  const text = `${HEADER}${rule}${blocks.map((block) => block.text).join(rule)}\n`;
  return {
    text,
    packages: blocks.map(({ name, version, license, hasFile }) => ({
      name,
      version,
      license,
      hasFile,
    })),
    problems,
  };
}

function main(argv) {
  const option = (flag) => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  const root = resolve(option('--root') ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
  const out = option('--out');
  const { text, packages, problems } = buildNotices(root);
  if (problems.length > 0) {
    console.error('Third-party license check failed:');
    for (const problem of problems) console.error(`  - ${problem}`);
    return 1;
  }
  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(resolve(out), text);
  }
  console.log(`Third-party notices: ${packages.length} packages${out ? ` -> ${out}` : ''}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
