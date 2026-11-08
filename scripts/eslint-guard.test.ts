import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: process.cwd() });

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
