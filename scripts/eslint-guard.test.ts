import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// The first lint call loads typescript-eslint and the whole config, which takes seconds on a busy
// machine: build the instance once and warm it up before any test runs.
vi.setConfig({ testTimeout: 30_000 });
let eslint: ESLint;
beforeAll(async () => {
  eslint = new ESLint({ cwd: process.cwd() });
  await eslint.lintText('export {};', { filePath: 'src/app/warmup.ts' });
}, 120_000);

async function rulesFired(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? 'parse-error');
}

const FETCH = "export const load = () => fetch('https://silo.example.test/api/v2/x');\n";
const WINDOW_FETCH = "export const load = () => window.fetch('/api/v2/x');\n";
const XHR = 'export const open = () => new XMLHttpRequest();\n';

describe('raw fetch guard', () => {
  it.each([
    ['fetch call', FETCH],
    ['window.fetch call', WINDOW_FETCH],
    ['XMLHttpRequest', XHR],
  ])('forbids a %s in application code', async (_name, code) => {
    expect(await rulesFired('src/app/screen.ts', code)).toEqual(['no-restricted-syntax']);
  });

  it.each(['src/probe/corsProbe.ts', 'src/api/transport/direct.ts'])(
    'allows raw requests in %s',
    async (file) => {
      expect(await rulesFired(file, FETCH + XHR)).toEqual([]);
    },
  );
});

describe('platform adapter guard', () => {
  const GLOBALS = [
    ['window.webOSSystem', 'export const v = window.webOSSystem?.deviceInfo;\n'],
    ['window.PalmSystem', 'export const v = window.PalmSystem?.launchParams;\n'],
    ['WebOSServiceBridge', 'export const B = window.WebOSServiceBridge;\n'],
    ['PalmServiceBridge', 'export const B = PalmServiceBridge;\n'],
  ] as const;
  const LUNA = "export const uri = 'luna://com.webos.service.config/getConfigs';\n";
  const LUNA_TEMPLATE = 'export const uri = `luna://${id}/fetch`;\n';

  it.each<[string, string]>([
    ...GLOBALS.map(([name, code]): [string, string] => [name, code]),
    ['a luna:// string', LUNA],
    ['a luna:// template', LUNA_TEMPLATE],
  ])('forbids %s outside src/platform', async (_name, code) => {
    expect(await rulesFired('src/features/screen.ts', code)).toEqual(['no-restricted-syntax']);
  });

  it('keeps forbidding them where raw requests are allowed (probe, transport)', async () => {
    expect(await rulesFired('src/probe/corsProbe.ts', GLOBALS[0][1])).toEqual([
      'no-restricted-syntax',
    ]);
    expect(await rulesFired('src/api/transport/service.ts', LUNA)).toEqual([
      'no-restricted-syntax',
    ]);
  });

  it.each([
    ["import { x } from '../platform/webos/luna';\n", 'src/features/screen.ts'],
    ["import { x } from '../../platform/webos';\n", 'src/api/session.ts'],
    ["import { x } from '../platform/browser';\n", 'src/app/focus.ts'],
    ["import { x } from '../platform/shared/mediaProbe';\n", 'src/playback/probe.ts'],
  ])('forbids the internal import %s', async (code, file) => {
    expect(await rulesFired(file, code + 'export const y = x;\n')).toEqual([
      'no-restricted-imports',
    ]);
  });

  it('does not apply the import ban inside src/platform itself', async () => {
    // `x` is used so that no-unused-vars does not mask what this test pins.
    const code = "import { x } from '../platform/webos/luna';\nexport const y = x;\n";
    expect(await rulesFired('src/platform/index.ts', code)).toEqual([]);
  });

  it('allows the platform index', async () => {
    expect(
      await rulesFired(
        'src/features/screen.ts',
        "import { getPlatform } from '../platform';\nexport const y = getPlatform();\n",
      ),
    ).toEqual([]);
  });

  it.each([
    'src/platform/webos/luna.ts',
    'src/platform/webos/device.ts',
    'src/platform/browser/index.ts',
    'src/platform/index.ts',
  ])('stays quiet inside %s', async (file) => {
    const code =
      GLOBALS.map(([, c], i) => c.replace('export const ', 'export const g' + i)).join('') +
      LUNA +
      "import { a } from './webos/luna';\nimport { b } from '../browser';\nexport const z = [a, b];\n";
    const fired = await rulesFired(file, code);
    expect(fired).toEqual([]);
  });
});

describe('navigation library guard', () => {
  const PACKAGE = '@noriginmedia/norigin-spatial-navigation';
  const IMPORT = [`import { setFocus } from '${PACKAGE}';`, 'export const y = setFocus;', ''].join(
    '\n',
  );

  it.each([
    'src/features/screen.ts',
    'src/app/FlowApp.tsx',
    'src/app/focus.ts',
    'src/playback/PlayerScreen.tsx',
    'src/platform/index.ts',
    'src/app/navigation.ts',
  ])('forbids importing the library in %s', async (file) => {
    expect(await rulesFired(file, IMPORT)).toEqual(['no-restricted-imports']);
  });

  it('forbids a type import too', async () => {
    expect(
      await rulesFired(
        'src/features/screen.ts',
        [`import type { KeyMap } from '${PACKAGE}';`, 'export type K = KeyMap;', ''].join('\n'),
      ),
    ).toEqual(['no-restricted-imports']);
  });

  it.each(['src/app/nav/init.ts', 'src/app/nav/Focusable.tsx'])(
    'allows it inside %s',
    async (file) => {
      expect(await rulesFired(file, IMPORT)).toEqual([]);
    },
  );

  it('allows screens to import the wrapper', async () => {
    expect(
      await rulesFired(
        'src/features/screen.ts',
        ["import { setFocus } from '../app/nav';", 'export const y = setFocus;', ''].join('\n'),
      ),
    ).toEqual([]);
  });

  it('keeps the platform import ban inside src/app/nav', async () => {
    expect(
      await rulesFired(
        'src/app/nav/init.ts',
        ["import { x } from '../../platform/webos/luna';", 'export const y = x;', ''].join('\n'),
      ),
    ).toEqual(['no-restricted-imports']);
  });
});
