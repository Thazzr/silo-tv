import { describe, expect, it } from 'vitest';
import { findModuleNameCollisions, listSourceFiles } from './module-name-collisions.mjs';

describe('findModuleNameCollisions', () => {
  it('flags names that differ only in case and extension', () => {
    expect(
      findModuleNameCollisions(['src/a/TrackMenus.test.tsx', 'src/a/trackMenus.test.ts']),
    ).toEqual([['src/a/TrackMenus.test.tsx', 'src/a/trackMenus.test.ts']]);
  });

  it.each([
    ['same name, different extension', ['src/a/x.ts', 'src/a/x.js']],
    ['declaration file next to its source', ['src/a/x.d.ts', 'src/a/X.ts']],
    ['module and CommonJS variants', ['src/a/x.mjs', 'src/a/X.cjs']],
  ])('flags %s', (_name, paths) => {
    expect(findModuleNameCollisions(paths)).toHaveLength(1);
  });

  it.each([
    ['same name in different directories', ['src/a/x.ts', 'src/b/X.ts']],
    ['different suffix before the extension', ['src/a/x.ts', 'src/a/x.test.ts']],
    ['non-code files', ['src/a/x.json', 'src/a/X.css']],
    ['screen test next to unit test', ['src/a/x.test.ts', 'src/a/x.screen.test.tsx']],
  ])('ignores %s', (_name, paths) => {
    expect(findModuleNameCollisions(paths)).toEqual([]);
  });
});

describe('repository hygiene', () => {
  it('no two source files share a name apart from case and extension', () => {
    const files = listSourceFiles(process.cwd(), ['src', 'scripts', 'tools', 'e2e', 'service']);
    const collisions = findModuleNameCollisions(files);
    expect(
      collisions,
      `TypeScript drops one of each pair on case-insensitive file systems:\n${collisions
        .map((group) => group.join(' <-> '))
        .join('\n')}`,
    ).toEqual([]);
  });
});
