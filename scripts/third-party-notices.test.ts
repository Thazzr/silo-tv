import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve(import.meta.dirname, 'third-party-notices.mjs');
const REPO = resolve(import.meta.dirname, '..');

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'notices-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

type Fixture = {
  license?: string;
  files?: Record<string, string>;
  dev?: boolean;
  dependencies?: Record<string, string>;
};

/** Writes package.json, package-lock.json and node_modules for the given packages. */
function install(
  packages: Record<string, Fixture>,
  rootDependencies: string[] = Object.keys(packages).filter((name) => !packages[name]?.dev),
) {
  const lockPackages: Record<string, object> = { '': {} };
  for (const [name, fixture] of Object.entries(packages)) {
    const directory = join(root, 'node_modules', ...name.split('/'));
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, 'package.json'),
      JSON.stringify({
        name,
        version: '1.0.0',
        license: fixture.license,
        dependencies: fixture.dependencies,
      }),
    );
    for (const [file, text] of Object.entries(fixture.files ?? {})) {
      writeFileSync(join(directory, file), text);
    }
    lockPackages[`node_modules/${name}`] = {
      version: '1.0.0',
      dev: fixture.dev,
      dependencies: fixture.dependencies,
    };
  }
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'app',
      version: '1.0.0',
      dependencies: Object.fromEntries(rootDependencies.map((name) => [name, '1.0.0'])),
      devDependencies: Object.fromEntries(
        Object.keys(packages)
          .filter((name) => !rootDependencies.includes(name))
          .map((name) => [name, '1.0.0']),
      ),
    }),
  );
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ packages: lockPackages }));
}

function run(args: string[] = []) {
  const out = join(root, 'out', 'NOTICES.txt');
  const result = spawnSync(process.execPath, [SCRIPT, '--root', root, '--out', out, ...args], {
    encoding: 'utf-8',
  });
  let text = '';
  try {
    text = readFileSync(out, 'utf-8');
  } catch {
    // The script writes nothing when it fails.
  }
  return { code: result.status, output: `${result.stdout}${result.stderr}`, text };
}

describe('third-party-notices', () => {
  it('lists production packages and leaves dev packages out', () => {
    install({
      'prod-a': { license: 'MIT', files: { LICENSE: 'Prod A license text' } },
      'dev-tool': { license: 'MIT', files: { LICENSE: 'Dev tool license text' }, dev: true },
    });
    const { code, text } = run();
    expect(code).toBe(0);
    expect(text).toContain('prod-a 1.0.0');
    expect(text).toContain('Prod A license text');
    expect(text).not.toContain('dev-tool');
  });

  it('follows runtime dependencies of production packages, including scoped ones', () => {
    install(
      {
        top: {
          license: 'MIT',
          files: { LICENSE: 'top' },
          dependencies: { '@scope/inner': '1.0.0' },
        },
        '@scope/inner': { license: 'ISC', files: { LICENSE: 'inner' } },
      },
      ['top'],
    );
    const { code, text } = run();
    expect(code).toBe(0);
    expect(text).toContain('@scope/inner 1.0.0');
  });

  it('includes license files in different spellings and a NOTICE file', () => {
    install({
      alpha: {
        license: 'Apache-2.0',
        files: { 'LICENSE.md': 'markdown license', NOTICE: 'the notice text' },
      },
      beta: { license: 'MIT', files: { licence: 'british spelling' } },
      gamma: { license: 'MIT', files: { 'COPYING.txt': 'copying text' } },
    });
    const { code, text } = run();
    expect(code).toBe(0);
    expect(text).toContain('markdown license');
    expect(text).toContain('the notice text');
    expect(text).toContain('british spelling');
    expect(text).toContain('copying text');
  });

  it('sorts the blocks by package name', () => {
    install({
      zebra: { license: 'MIT', files: { LICENSE: 'z' } },
      apple: { license: 'MIT', files: { LICENSE: 'a' } },
      mango: { license: 'MIT', files: { LICENSE: 'm' } },
    });
    const { text } = run();
    const positions = ['apple 1.0.0', 'mango 1.0.0', 'zebra 1.0.0'].map((name) =>
      text.indexOf(name),
    );
    expect(positions.every((position) => position > 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('starts with a header naming the app license and the source link', () => {
    install({ a: { license: 'MIT', files: { LICENSE: 'x' } } });
    const { text } = run();
    expect(text).toContain('MPL-2.0');
    expect(text).toContain('https://github.com/Thazzr/silo-tv');
  });

  it('fails for a GPL-3.0 package and names it', () => {
    install({ copyleft: { license: 'GPL-3.0', files: { LICENSE: 'gpl' } } });
    const { code, output, text } = run();
    expect(code).toBe(1);
    expect(output).toContain('copyleft@1.0.0');
    expect(output).toContain('GPL-3.0');
    expect(text).toBe('');
  });

  it('fails for a package without a license field', () => {
    install({ nolicense: { files: { LICENSE: 'text' } } });
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain('nolicense@1.0.0');
    expect(output).toContain('no license field');
  });

  it('passes an OR expression with one allowed side and fails when none is allowed', () => {
    install({ dual: { license: 'MIT OR GPL-3.0', files: { LICENSE: 'dual' } } });
    expect(run().code).toBe(0);
    rmSync(join(root, 'node_modules'), { recursive: true });
    install({ both: { license: '(GPL-2.0 OR AGPL-3.0)', files: { LICENSE: 'x' } } });
    expect(run().code).toBe(1);
  });

  it('fails an AND expression with a disallowed side', () => {
    install({ mixed: { license: 'MIT AND GPL-3.0', files: { LICENSE: 'x' } } });
    expect(run().code).toBe(1);
  });

  it('writes a standard line for an allowed license without a license file', () => {
    install({ bare: { license: 'MIT' } });
    const { code, text } = run();
    expect(code).toBe(0);
    expect(text).toContain('License: MIT (no license file in the package)');
  });

  it('fails when a production package is not installed', () => {
    install({ ghost: { license: 'MIT' } });
    rmSync(join(root, 'node_modules', 'ghost'), { recursive: true });
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain('not installed');
  });

  it('works on the real repository: exit 0 with react, hls.js and core-js', () => {
    const out = join(root, 'real.txt');
    const result = spawnSync(process.execPath, [SCRIPT, '--root', REPO, '--out', out], {
      encoding: 'utf-8',
    });
    expect(result.status, result.stderr).toBe(0);
    const text = readFileSync(out, 'utf-8');
    for (const name of ['react 19', 'hls.js 1', 'core-js 3']) expect(text).toContain(name);
  });
});
