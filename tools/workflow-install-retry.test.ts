// The "Install Chromium" step of ci.yml and release.yml retries the apt-backed install-deps, so a
// short outage of the runner's Ubuntu mirror does not fail the run. The step's shell is run here
// with a stub `npx` (and a stub `sleep`, so the test does not wait).
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const STEP = 'Install Chromium for the E2E tests';
const INDENT = 10;

// A checkout with core.autocrlf has CRLF line endings; the parsing below expects LF.
const readWorkflow = (name: string) =>
  readFileSync(resolve(ROOT, '.github/workflows', name), 'utf-8').replace(/\r\n/g, '\n');

// The `run: |` script of the step, de-indented.
const stepScript = (yaml: string) => {
  const start = yaml.indexOf(`- name: ${STEP}\n`);
  if (start < 0) return '';
  const after = yaml.slice(start);
  const marker = 'run: |\n';
  const lines = after.slice(after.indexOf(marker) + marker.length).split('\n');
  const body: string[] = [];
  for (const line of lines) {
    if (line !== '' && !line.startsWith(' '.repeat(INDENT))) break;
    body.push(line.slice(INDENT));
  }
  return body.join('\n');
};

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// A Windows path as Git Bash reads it (C:\a\b -> /c/a/b), so it can sit in PATH after a colon.
const posix = (p: string) =>
  p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`);

// Runs the script with `npx playwright install-deps` failing `failures` times, then succeeding.
// `launches` is whether the stub `node` (the headless-shell launch check) succeeds.
const run = (script: string, failures: number, launches = false) => {
  const dir = mkdtempSync(join(tmpdir(), 'retry-'));
  dirs.push(dir);
  const log = posix(join(dir, 'log'));
  const count = posix(join(dir, 'count'));
  writeFileSync(
    join(dir, 'npx'),
    `#!/bin/bash
echo "npx $*" >> "${log}"
if [ "$2" = "install-deps" ]; then
  n=$(cat "${count}" 2>/dev/null || echo 0)
  n=$((n + 1))
  echo $n > "${count}"
  [ "$n" -gt ${failures} ] || exit 100
fi
`,
  );
  writeFileSync(
    join(dir, 'node'),
    `#!/bin/bash
echo "node $*" >> "${log}"
${launches ? '' : 'exit 1\n'}`,
  );
  chmodSync(join(dir, 'node'), 0o755);
  writeFileSync(join(dir, 'sleep'), `#!/bin/bash\necho "sleep $*" >> "${log}"\n`);
  chmodSync(join(dir, 'npx'), 0o755);
  chmodSync(join(dir, 'sleep'), 0o755);
  const res = spawnSync('bash', ['-e', '-c', `PATH="${posix(dir)}:$PATH"\n${script}`], {
    encoding: 'utf-8',
  });
  let calls: string[] = [];
  try {
    calls = readFileSync(join(dir, 'log'), 'utf-8').trim().split('\n');
  } catch {
    // no stub call was logged; the assertions on `calls` report it
  }
  return { status: res.status, calls };
};

describe.each(['ci.yml', 'release.yml'])('%s: install-deps retry', (file) => {
  const script = () => stepScript(readWorkflow(file));
  const deps = (calls: string[]) => calls.filter((c) => c.includes('install-deps'));
  const sleeps = (calls: string[]) => calls.filter((c) => c.startsWith('sleep'));

  const launch = (calls: string[]) => calls.filter((c) => c.startsWith('node'));

  it('skips install-deps when the headless shell starts with the runner libraries', () => {
    const r = run(script(), 99, true);
    expect(launch(r.calls)).toHaveLength(1);
    expect(deps(r.calls)).toEqual([]);
    expect(sleeps(r.calls)).toEqual([]);
    expect(r.status).toBe(0);
  });

  it('checks the launch before it calls install-deps, and only then', () => {
    const r = run(script(), 0);
    expect(launch(r.calls)).toHaveLength(1);
    expect(r.calls.findIndex((c) => c.startsWith('node'))).toBeLessThan(
      r.calls.findIndex((c) => c.includes('install-deps')),
    );
  });

  it('bounds the step and the job with a timeout', () => {
    const yaml = readWorkflow(file);
    const stepStart = yaml.indexOf(`- name: ${STEP}\n`);
    const stepHead = yaml.slice(stepStart, yaml.indexOf('run: |', stepStart));
    expect(stepHead).toMatch(/\n {8}timeout-minutes: \d+\n/);
    const jobHead = yaml.slice(yaml.indexOf('\njobs:'), yaml.indexOf('    steps:'));
    expect(jobHead).toMatch(/\n {4}timeout-minutes: \d+\n/);
  });

  it('stays a plain step: nothing that would hide a failure', () => {
    expect(readWorkflow(file)).not.toContain('continue-on-error');
    expect(script()).not.toContain('|| true');
    expect(script()).toContain('npx playwright install-deps chromium');
  });

  it('retries after two failures and then succeeds, pausing 30 s and 60 s', () => {
    const r = run(script(), 2);
    expect(deps(r.calls)).toHaveLength(3);
    expect(sleeps(r.calls)).toEqual(['sleep 30', 'sleep 60']);
    expect(r.status).toBe(0);
  });

  it('does not retry or sleep when the first attempt works', () => {
    const r = run(script(), 0);
    expect(deps(r.calls)).toHaveLength(1);
    expect(sleeps(r.calls)).toEqual([]);
    expect(r.status).toBe(0);
  });

  it('fails the step after three failed attempts', () => {
    const r = run(script(), 99);
    expect(deps(r.calls)).toHaveLength(3);
    expect(r.status).not.toBe(0);
  });
});
