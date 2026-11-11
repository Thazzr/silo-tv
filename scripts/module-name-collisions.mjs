// Finds source files that differ only in case and extension ("trackMenus.test.ts" next to
// "TrackMenus.test.tsx"). On a case-insensitive file system (Windows, macOS) TypeScript's
// `include` treats them as one module name and silently drops one of them from the program,
// so a type error in the dropped file only shows up on a case-sensitive CI runner.
import { readdirSync } from 'node:fs';
import { join, posix } from 'node:path';

const EXTENSION = /\.(d\.ts|tsx|ts|mts|cts|jsx|js|mjs|cjs)$/;

/** Groups repository-relative paths by directory and lower-cased name without extension. */
export function findModuleNameCollisions(paths) {
  const groups = new Map();
  for (const path of paths) {
    if (!EXTENSION.test(path)) continue;
    const key =
      posix.dirname(path) + '/' + posix.basename(path).replace(EXTENSION, '').toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), path]);
  }
  return [...groups.values()].filter((group) => group.length > 1).map((group) => group.sort());
}

/** All files below the given top-level directories, as repository-relative posix paths. */
export function listSourceFiles(root, directories) {
  const files = [];
  const walk = (relative) => {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const next = posix.join(relative, entry.name);
      if (entry.isDirectory()) walk(next);
      else files.push(next);
    }
  };
  for (const directory of directories) walk(directory);
  return files;
}
