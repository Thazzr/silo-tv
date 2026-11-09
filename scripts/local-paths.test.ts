import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findLocalPaths } from './local-paths.mjs';

// Examples are assembled so this file does not trip the repository scan itself.
const users = 'Us' + 'ers';
const home = 'ho' + 'me';
const appData = 'App' + 'Data';

describe('findLocalPaths', () => {
  it.each([
    ['windows backslash', `C:\\${users}\\Jane\\proj\\x.png`],
    ['windows forward slash', `d:/${users}/Jane/proj`],
    ['windows 8.3 short name', `C:\\${users}\\JANEDO~1\\x`],
    ['windows escaped in a string', `'C:\\\\${users}\\\\Jane\\\\x'`],
    ['temp folder, backslash', `x\\${appData}\\Local\\Temp\\shots`],
    ['temp folder, slash', `x/${appData}/Local/Temp/shots`],
    ['macOS home', `/${users}/jane/Library/x`],
    ['linux home', `path: /${home}/jane/.cache`],
  ])('flags %s', (_name, text) => {
    expect(findLocalPaths(text)).toHaveLength(1);
  });

  it.each([
    'https://example.test/api/v2/items',
    `https://example.test/${users}/jane/profile`,
    `https://example.test/${home}/jane/`,
    "'test-results/shots/x.png'",
    '/api/v2/auth/device',
    'src/features/home/Home.tsx',
    `the ${users} of the app, at ${home}`,
    'C:' + 'relative',
  ])('ignores %s', (text) => {
    expect(findLocalPaths(text)).toEqual([]);
  });

  it('reports the 1-based line', () => {
    expect(findLocalPaths(`ok\r\nbad /${home}/jane/x`)).toMatchObject([{ line: 2 }]);
  });
});

describe('repository hygiene', () => {
  it('no tracked text file contains a machine-specific path', () => {
    const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 26 })
      .split('\0')
      .filter(Boolean);
    const offenders: string[] = [];
    for (const file of files) {
      let buffer: Buffer;
      try {
        buffer = readFileSync(file);
      } catch {
        continue; // tracked but deleted in the working tree
      }
      if (buffer.includes(0)) continue; // binary
      for (const f of findLocalPaths(buffer.toString('utf8'))) {
        offenders.push(`${file}:${f.line} (${f.rule}) ${f.text}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
