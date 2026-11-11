// The release workflow, read as text (like the workflow checks in status-card.test.ts).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
// A checkout with core.autocrlf has CRLF line endings; the patterns below expect LF.
const read = () =>
  readFileSync(resolve(ROOT, '.github/workflows/release.yml'), 'utf-8').replace(/\r\n/g, '\n');

// The text of one job: from its "  name:" line to the next job or the end of the file.
const section = (yaml: string, job: string) => {
  const start = yaml.indexOf(`\n  ${job}:\n`);
  if (start < 0) return '';
  const rest = yaml.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
};

describe('release workflow', () => {
  it('runs on pushed v* tags only', () => {
    const yaml = read();
    expect(yaml).toMatch(/^on:\n {2}push:\n {4}tags: \['v\*'\]\n/m);
    expect(yaml).not.toContain('pull_request');
    expect(yaml).not.toContain('branches:');
  });

  it('is read-only at the top and writes only on the publish job', () => {
    const yaml = read();
    expect(yaml).toMatch(/^permissions:\n {2}contents: read\n/m);
    const writes = yaml.match(/contents: write/g) ?? [];
    expect(writes).toHaveLength(1);
    expect(section(yaml, 'publish')).toContain('contents: write');
    expect(section(yaml, 'build')).toMatch(/permissions:\n {6}contents: read\n/);
    expect(section(yaml, 'build')).not.toContain('contents: write');
  });

  it('keeps the token out of the build job, which runs third-party code', () => {
    const build = section(read(), 'build');
    expect(build).toContain('npm ci');
    expect(build).not.toContain('GH_TOKEN');
    expect(build).not.toContain('github.token');
  });

  it('publishes from the artifact only: no checkout, no npm', () => {
    const publish = section(read(), 'publish');
    expect(publish).toMatch(/needs: build\n/);
    expect(publish).not.toContain('actions/checkout');
    expect(publish).not.toContain('actions/setup-node');
    expect(publish).not.toContain('npm ci');
    expect(publish).not.toMatch(/\bnpm /);
    expect(publish).not.toMatch(/\bnpx /);
  });

  it('hands the token to exactly one place: the env of the gh release create step', () => {
    const yaml = read();
    expect(yaml.match(/GH_TOKEN/g)).toHaveLength(1);
    expect(yaml.match(/github\.token/g)).toHaveLength(1);
    const step = yaml.slice(yaml.indexOf('      - name: Create the release'));
    const env = step.indexOf('GH_TOKEN: ${{ github.token }}');
    expect(env).toBeGreaterThan(0);
    expect(step.indexOf('GH_REPO: ${{ github.repository }}')).toBeGreaterThan(0);
    expect(step.indexOf('TAG: ${{ github.ref_name }}')).toBeGreaterThan(0);
    expect(step.indexOf('env:')).toBeLessThan(env);
    expect(env).toBeLessThan(step.indexOf('run: |'));
    expect(step.indexOf('run: |')).toBeLessThan(step.indexOf('gh release create'));
  });

  it('uploads and downloads the same artifact', () => {
    const yaml = read();
    const up = /upload-artifact@[^\n]*\n\s+with:\n\s+name: (release-assets)\n/.exec(
      section(yaml, 'build'),
    );
    const down = /download-artifact@[^\n]*\n\s+with:\n\s+name: (\S+)\n/.exec(
      section(yaml, 'publish'),
    );
    expect(up).not.toBeNull();
    expect(down).not.toBeNull();
    expect(down?.[1]).toBe(up?.[1]);
    expect(section(yaml, 'build')).toContain('retention-days: 7');
  });

  it('uploads exactly the .ipk, its checksum, the notices and the notes', () => {
    const build = section(read(), 'build');
    const block = /name: release-assets\n\s+path: \|\n((?:\s{12}\S.*\n)+)/.exec(build);
    expect(
      (block?.[1] ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    ).toEqual(['out/*.ipk', 'out/*.ipk.sha256', 'dist/THIRD_PARTY_NOTICES.txt', 'notes.md']);
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

  it('checks the tag, runs the gate, checksums, writes the notes and uploads, then publishes', () => {
    const yaml = read();
    const build = section(yaml, 'build');
    const check = build.indexOf('node scripts/release-check.mjs "$TAG"');
    const gate = build.indexOf('pwsh -NoProfile -File tools/verify.ps1');
    const checksum = build.indexOf('sha256sum');
    const notes = build.indexOf('git-cliff -c');
    const upload = build.indexOf('name: release-assets');
    expect(check).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(check);
    expect(checksum).toBeGreaterThan(gate);
    expect(notes).toBeGreaterThan(checksum);
    expect(upload).toBeGreaterThan(notes);
    expect(yaml.indexOf('gh release create')).toBeGreaterThan(yaml.indexOf('\n  publish:\n'));
  });

  it('verifies the tag and attaches the notes', () => {
    const yaml = read();
    expect(yaml).toContain('--verify-tag');
    expect(yaml).toContain('--notes-file notes.md');
  });

  // The "Create the release" script, with gh replaced by an echo, run for one tag.
  const channelFor = (tag: string) => {
    const yaml = read();
    const script = yaml
      .slice(yaml.indexOf('version="${TAG#v}"'), yaml.indexOf('gh release create'))
      .replace(/^ {10}/gm, '');
    return execFileSync('bash', ['-c', `${script}echo "\${channel[@]}"`], {
      env: { ...process.env, TAG: tag },
    })
      .toString()
      .trim();
  };

  it('marks a tag with a SemVer pre-release suffix as a pre-release and never as latest', () => {
    expect(channelFor('v0.4.0-rc.1')).toBe('--prerelease --latest=false');
    expect(channelFor('v1.0.0-beta.2')).toBe('--prerelease --latest=false');
  });

  it('makes every other tag a normal release and the latest one, 0.x included', () => {
    expect(channelFor('v0.3.0')).toBe('--latest');
    expect(channelFor('v1.2.3')).toBe('--latest');
  });

  it('passes the chosen release channel to gh release create', () => {
    expect(read()).toMatch(/gh release create "\$TAG" [^\n]*"\$\{channel\[@\]\}"/);
  });

  it('attaches exactly one .ipk, its checksum and the third-party notices', () => {
    const yaml = read();
    expect(yaml).toContain('out/*.ipk out/*.ipk.sha256 dist/THIRD_PARTY_NOTICES.txt');
    expect(section(yaml, 'publish')).toContain('Expected exactly one .ipk, found $count');
  });

  it('builds the notes from the tag annotation and the latest changelog section without the header', () => {
    const yaml = read();
    expect(yaml).toContain(`git for-each-ref "refs/tags/$TAG" --format='%(contents)'`);
    expect(yaml).toContain('git-cliff -c cliff.toml --latest --strip header');
  });

  it('passes the tag through env, never through ${{ }} inside a script', () => {
    const yaml = read();
    expect(yaml).toContain('TAG: ${{ github.ref_name }}');
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

  it('uploads the gate reports even when the gate fails, in the build job', () => {
    const yaml = read();
    expect(yaml.match(/if: always\(\)/g)).toHaveLength(2);
    expect(section(yaml, 'build').match(/if: always\(\)/g)).toHaveLength(2);
  });

  it('pins every action to a SHA that ci.yml or mutation.yml already uses', () => {
    const uses = (file: string) =>
      [
        ...readFileSync(resolve(ROOT, '.github/workflows', file), 'utf-8').matchAll(
          /uses: (\S+@[0-9a-f]{40})/g,
        ),
      ].map((match) => match[1]);
    const known = new Set([...uses('ci.yml'), ...uses('mutation.yml')]);
    const release = uses('release.yml');
    expect(release.length).toBeGreaterThan(0);
    for (const action of release) expect(known.has(action)).toBe(true);
    expect(read().match(/uses: /g)).toHaveLength(release.length);
  });
});
