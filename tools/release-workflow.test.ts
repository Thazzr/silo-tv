// The release workflow, read as text (like the workflow checks in status-card.test.ts).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
// A checkout with core.autocrlf has CRLF line endings; the patterns below expect LF.
const read = () =>
  readFileSync(resolve(ROOT, '.github/workflows/release.yml'), 'utf-8').replace(/\r\n/g, '\n');

describe('release workflow', () => {
  it('runs on pushed v* tags only', () => {
    const yaml = read();
    expect(yaml).toMatch(/^on:\n {2}push:\n {4}tags: \['v\*'\]\n/m);
    expect(yaml).not.toContain('pull_request');
    expect(yaml).not.toContain('branches:');
  });

  it('is read-only at the top and writes only on the release job', () => {
    const yaml = read();
    expect(yaml).toMatch(/^permissions:\n {2}contents: read\n/m);
    const writes = yaml.match(/contents: write/g) ?? [];
    expect(writes).toHaveLength(1);
    expect(yaml.indexOf('contents: write')).toBeGreaterThan(yaml.indexOf('\njobs:'));
  });

  it('serializes per tag without cancelling', () => {
    const yaml = read();
    expect(yaml).toContain('group: release-${{ github.ref_name }}');
    expect(yaml).toContain('cancel-in-progress: false');
  });

  it('checks out the full history without persisting credentials', () => {
    const yaml = read();
    expect(yaml).toContain('fetch-depth: 0');
    expect(yaml).toContain('persist-credentials: false');
  });

  it('checks the tag, then runs the gate, then creates the release', () => {
    const yaml = read();
    const check = yaml.indexOf('node scripts/release-check.mjs "$TAG"');
    const gate = yaml.indexOf('pwsh -NoProfile -File tools/verify.ps1');
    const checksum = yaml.indexOf('sha256sum');
    const create = yaml.indexOf('gh release create');
    expect(check).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(check);
    expect(checksum).toBeGreaterThan(gate);
    expect(create).toBeGreaterThan(checksum);
  });

  it('verifies the tag and marks 0.x releases as pre-releases', () => {
    const yaml = read();
    expect(yaml).toContain('--verify-tag');
    expect(yaml).toContain('--notes-file notes.md');
    expect(yaml).toContain('if [ "${version%%.*}" = "0" ]');
    expect(yaml).toContain('--prerelease');
  });

  it('attaches the .ipk, its checksum and the third-party notices', () => {
    const yaml = read();
    expect(yaml).toContain('out/*.ipk out/*.ipk.sha256 dist/THIRD_PARTY_NOTICES.txt');
  });

  it('builds the notes from the tag annotation and the latest changelog section without the header', () => {
    const yaml = read();
    expect(yaml).toContain(`git for-each-ref "refs/tags/$TAG" --format='%(contents)'`);
    expect(yaml).toContain('git-cliff -c cliff.toml --latest --strip header');
  });

  it('passes the tag and the token through env, never through ${{ }} inside a script', () => {
    const yaml = read();
    expect(yaml).toContain('TAG: ${{ github.ref_name }}');
    expect(yaml).toContain('GH_TOKEN: ${{ github.token }}');
    const lines = yaml.split('\n');
    let inScript = false;
    let indent = 0;
    const offenders: string[] = [];
    for (const line of lines) {
      const startsScript = /^\s*(- )?run:/.exec(line);
      if (startsScript) {
        if (line.includes('${{')) offenders.push(line.trim());
        inScript = /run:\s*[|>]/.test(line);
        indent = line.length - line.trimStart().length;
        continue;
      }
      if (inScript) {
        const current = line.length - line.trimStart().length;
        if (line.trim() !== '' && current <= indent) inScript = false;
        else if (line.includes('${{')) offenders.push(line.trim());
      }
    }
    expect(offenders).toEqual([]);
  });

  it('uploads the gate reports even when the gate fails', () => {
    const yaml = read();
    expect(yaml.match(/if: always\(\)/g)).toHaveLength(2);
  });

  it('pins every action to the same SHA as ci.yml', () => {
    const uses = (file: string) =>
      [
        ...readFileSync(resolve(ROOT, '.github/workflows', file), 'utf-8').matchAll(
          /uses: (\S+@[0-9a-f]{40})/g,
        ),
      ].map((match) => match[1]);
    const ci = new Set(uses('ci.yml'));
    const release = uses('release.yml');
    expect(release.length).toBeGreaterThan(0);
    for (const action of release) expect(ci.has(action)).toBe(true);
    expect(read().match(/uses: /g)).toHaveLength(release.length);
  });
});
