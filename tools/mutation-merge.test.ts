import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { filesOfShard } from './mutation-shards.mjs';
import {
  ELEMENTS_FILE,
  escapeForScript,
  expandInputs,
  main,
  mergeReports,
  renderHtml,
  restrictReport,
} from './mutation-merge.mjs';

interface Mutant {
  id: string;
  status: string;
  coveredBy?: string[];
  killedBy?: string[];
}

interface Merged {
  schemaVersion: string;
  projectRoot: string;
  thresholds: unknown;
  files: Record<string, { mutants: Mutant[]; source?: string }>;
  testFiles: Record<string, { tests: Array<{ id: string; name: string }> }>;
}

const merge = (reports: unknown[]) => mergeReports(reports) as Merged;

function report(
  files: Record<string, Mutant[]>,
  tests: Record<string, Array<{ id: string; name: string; line?: number }>> = {},
) {
  return {
    schemaVersion: '1.0',
    thresholds: { high: 80, low: 60, break: null },
    projectRoot: '/repo',
    files: Object.fromEntries(
      Object.entries(files).map(([path, mutants]) => [
        path,
        { language: 'typescript', source: `// ${path}`, mutants },
      ]),
    ),
    testFiles: Object.fromEntries(
      Object.entries(tests).map(([path, list]) => [
        path,
        {
          tests: list.map(({ id, name, line }) => ({
            id,
            name,
            ...(line ? { location: { start: { line, column: 1 } } } : {}),
          })),
        },
      ]),
    ),
  };
}

describe('mergeReports', () => {
  it('unites the files and takes schemaVersion, thresholds and projectRoot from the first', () => {
    const first = report({ 'src/a.ts': [{ id: '0', status: 'Killed' }] });
    const second = {
      ...report({ 'src/b.ts': [{ id: '0', status: 'Survived' }] }),
      projectRoot: '/other',
    };
    const merged = merge([first, second]);
    expect(Object.keys(merged.files)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(merged.projectRoot).toBe('/repo');
    expect(merged.schemaVersion).toBe('1.0');
    expect(merged.thresholds).toEqual(first.thresholds);
  });

  it('renumbers the mutant ids so they stay unique', () => {
    const merged = merge([
      report({
        'src/a.ts': [
          { id: '0', status: 'Killed' },
          { id: '1', status: 'Killed' },
        ],
      }),
      report({ 'src/b.ts': [{ id: '0', status: 'Killed' }] }),
    ]);
    const ids = Object.values(merged.files).flatMap((f) => f.mutants.map((m) => m.id));
    expect(new Set(ids).size).toBe(3);
  });

  it('unites test files by path and tests by name and location, and follows the ids', () => {
    const shared = { id: '0', name: 'shared test', line: 3 };
    const one = report(
      { 'src/a.ts': [{ id: '0', status: 'Killed', coveredBy: ['0', '1'], killedBy: ['1'] }] },
      { 'src/x.test.ts': [shared, { id: '1', name: 'only in one', line: 9 }] },
    );
    // The same test has another id in the second report, and another test took id 1.
    const two = report(
      { 'src/b.ts': [{ id: '0', status: 'Killed', coveredBy: ['1'], killedBy: ['1'] }] },
      {
        'src/x.test.ts': [
          { id: '0', name: 'only in two', line: 20 },
          { ...shared, id: '1' },
        ],
      },
    );
    const merged = merge([one, two]);
    const tests = merged.testFiles['src/x.test.ts']!.tests;
    expect(tests.map((t) => t.name)).toEqual(['shared test', 'only in one', 'only in two']);
    const idOf = (name: string) => tests.find((t) => t.name === name)!.id;
    const a = merged.files['src/a.ts']!.mutants[0]!;
    const b = merged.files['src/b.ts']!.mutants[0]!;
    expect(a.coveredBy).toEqual([idOf('shared test'), idOf('only in one')]);
    expect(a.killedBy).toEqual([idOf('only in one')]);
    // Without the renumbering, "1" of the second report would point at "only in one".
    expect(b.coveredBy).toEqual([idOf('shared test')]);
    expect(b.killedBy).toEqual([idOf('shared test')]);
  });

  it('treats a file in two reports as an error', () => {
    const a = report({ 'src/a.ts': [{ id: '0', status: 'Killed' }] });
    expect(() => mergeReports([a, a])).toThrow(/src\/a\.ts.*more than one report/);
  });

  it('refuses to merge nothing', () => {
    expect(() => mergeReports([])).toThrow();
  });
});

describe('restrictReport', () => {
  it('drops the files that are not listed', () => {
    const restricted = restrictReport(report({ 'src/a.ts': [], 'src/b.ts': [] }), ['src/b.ts']);
    expect(Object.keys(restricted.files)).toEqual(['src/b.ts']);
  });
});

describe('HTML', () => {
  it('escapes everything that could end the script element', () => {
    const json = JSON.stringify({ source: 'x </script><script>alert(1)</script> <!-- y' });
    const escaped = escapeForScript(json);
    expect(escaped).not.toContain('<');
    expect(JSON.parse(escaped)).toEqual(JSON.parse(json));
  });

  it('assigns the report to the app element and loads the elements file', () => {
    const html = renderHtml(report({ 'src/a.ts': [{ id: '0', status: 'Killed' }] }));
    expect(html).toContain(`<script src="${ELEMENTS_FILE}"></script>`);
    expect(html).toContain('<mutation-test-report-app');
    expect(html).toMatch(/querySelector\('mutation-test-report-app'\)\.report = \{/);
    expect(html).toContain('src/a.ts');
  });

  it('keeps a source file with a closing script tag from breaking out', () => {
    const evil = report({ 'src/a.ts': [] });
    evil.files['src/a.ts']!.source = 'const s = "</script><img src=x onerror=alert(1)>";';
    const html = renderHtml(evil);
    // Only the two real script elements close.
    expect(html.match(/<\/script>/g)).toHaveLength(2);
    expect(html).not.toContain('<img');
  });
});

describe('expandInputs', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mutation-merge-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('finds the json files of a directory tree and ignores the rest', () => {
    mkdirSync(join(dir, 'mutation-shard-1'));
    writeFileSync(join(dir, 'mutation-shard-1', 'mutation.json'), '{}');
    writeFileSync(join(dir, 'notes.txt'), '');
    expect(expandInputs([dir])).toEqual([join(dir, 'mutation-shard-1', 'mutation.json')]);
  });
});

describe('main', () => {
  let dir: string;
  let elements: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mutation-merge-'));
    elements = join(dir, 'elements.js');
    writeFileSync(elements, '/* elements */');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function write(name: string, content: unknown) {
    const path = join(dir, name);
    writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
    return path;
  }

  const quiet = () => vi.spyOn(console, 'log').mockImplementation(() => {});
  const filesOf = (out: string) =>
    Object.keys(JSON.parse(readFileSync(join(out, 'mutation.json'), 'utf-8')).files);

  it('writes the merged report, the page and the copied elements file', () => {
    quiet();
    const a = write('a.json', report({ 'src/a.ts': [{ id: '0', status: 'Killed' }] }));
    const b = write('b.json', report({ 'src/b.ts': [{ id: '0', status: 'Survived' }] }));
    const out = join(dir, 'out');
    main(['--out', out, a, b], elements);
    expect(filesOf(out)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(readFileSync(join(out, 'index.html'), 'utf-8')).toContain('src/b.ts');
    expect(readFileSync(join(out, ELEMENTS_FILE), 'utf-8')).toBe('/* elements */');
  });

  it('writes no page with --no-html', () => {
    quiet();
    const a = write('a.json', report({ 'src/a.ts': [] }));
    const out = join(dir, 'out');
    main(['--out', out, '--no-html', a], elements);
    expect(existsSync(join(out, 'mutation.json'))).toBe(true);
    expect(existsSync(join(out, 'index.html'))).toBe(false);
  });

  it('fails with --expect when fewer reports are given, and writes nothing', () => {
    const a = write('a.json', report({ 'src/a.ts': [] }));
    const out = join(dir, 'out');
    expect(() => main(['--out', out, '--expect', '2', a], elements)).toThrow(/Expected 2.*got 1/);
    expect(existsSync(out)).toBe(false);
  });

  it('fails with --expect when a report is unreadable', () => {
    const a = write('a.json', report({ 'src/a.ts': [] }));
    const broken = write('b.json', '{ not json');
    expect(() => main(['--out', join(dir, 'out'), '--expect', '2', a, broken], elements)).toThrow(
      /Cannot read/,
    );
  });

  it('skips an unreadable report with a warning without --expect', () => {
    quiet();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = write('a.json', report({ 'src/a.ts': [] }));
    const broken = write('b.json', '{ not json');
    const out = join(dir, 'out');
    main(['--out', out, '--no-html', a, broken], elements);
    expect(warn).toHaveBeenCalled();
    expect(filesOf(out)).toEqual(['src/a.ts']);
  });

  it('rejects a file that is not a report', () => {
    const notReport = write('x.json', { hello: 1 });
    expect(() => main(['--out', join(dir, 'out'), '--expect', '1', notReport], elements)).toThrow(
      /not a mutation report/,
    );
  });

  it('with --shard keeps only the shard files, so cached entries of other shards do not repeat', () => {
    quiet();
    const own = filesOfShard('1/24')[0]!;
    const other = filesOfShard('2/24')[0]!;
    const a = write(
      'a.json',
      report({ [own]: [{ id: '0', status: 'Killed' }], [other]: [{ id: '1', status: 'Killed' }] }),
    );
    const out = join(dir, 'out');
    main(['--out', out, '--no-html', '--shard', '1/24', a], elements);
    expect(filesOf(out)).toEqual([own]);
  });

  it('requires --out and rejects unknown options', () => {
    expect(() => main([], elements)).toThrow(/--out/);
    expect(() => main(['--out', dir, '--bogus'], elements)).toThrow(/Unknown option/);
  });
});
