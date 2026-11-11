import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve(import.meta.dirname, 'release-check.mjs');

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'release-check-'));
  mkdirSync(join(root, 'public'));
  mkdirSync(join(root, 'service'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function versions(
  overrides: Partial<Record<'pkg' | 'appinfo' | 'service' | 'lock' | 'lockRoot', string>> = {},
) {
  const v = {
    pkg: '0.3.0',
    appinfo: '0.3.0',
    service: '0.3.0',
    lock: '0.3.0',
    lockRoot: '0.3.0',
    ...overrides,
  };
  const write = (path: string, data: object) =>
    writeFileSync(join(root, path), JSON.stringify(data));
  write('package.json', { version: v.pkg });
  write('public/appinfo.json', { version: v.appinfo });
  write('service/package.json', { version: v.service });
  write('package-lock.json', { version: v.lock, packages: { '': { version: v.lockRoot } } });
}

function run(tag: string) {
  const result = spawnSync(process.execPath, [SCRIPT, tag, '--root', root], { encoding: 'utf-8' });
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
}

describe('release-check', () => {
  it('passes when the tag and every version agree', () => {
    versions();
    expect(run('v0.3.0').code).toBe(0);
  });

  it('accepts a pre-release SemVer tag when all versions match it', () => {
    versions({
      pkg: '1.0.0-rc.1',
      appinfo: '1.0.0-rc.1',
      service: '1.0.0-rc.1',
      lock: '1.0.0-rc.1',
      lockRoot: '1.0.0-rc.1',
    });
    expect(run('v1.0.0-rc.1').code).toBe(0);
  });

  it.each(['0.3.0', 'v0.3', 'v1.2.3.4', 'vfoo', 'v01.2.3', ''])('rejects the tag "%s"', (tag) => {
    versions();
    const { code, output } = run(tag);
    expect(code).toBe(1);
    expect(output).toContain('SemVer');
  });

  it.each([
    ['pkg', 'package.json'],
    ['appinfo', 'public/appinfo.json'],
    ['service', 'service/package.json'],
    ['lock', 'package-lock.json (root)'],
    ['lockRoot', 'package-lock.json (packages[""])'],
  ] as const)('fails and names the file when %s differs', (key, name) => {
    versions({ [key]: '0.2.0' });
    const { code, output } = run('v0.3.0');
    expect(code).toBe(1);
    expect(output).toContain(name);
    expect(output).toContain('0.2.0');
  });
});
