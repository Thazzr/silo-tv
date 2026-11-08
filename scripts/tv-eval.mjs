// Reads data from the app on the TV through the webOS Web Inspector (Chrome DevTools Protocol).
// Usage: npm run tv:eval -- [expression] [--wait-for <expr>] [--timeout <s>] [--device <name>]
//        [--out <file>]
// Without an expression it prints the TV probe report (window.__SILO_PROBE__) once it is done.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createCdpClient,
  formatValue,
  parseArgs,
  parseInspectorUrl,
  pickTarget,
} from './tv-eval-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inspectScript = resolve(
  root,
  'node_modules',
  '@webos-tools',
  'cli',
  'bin',
  'ares-inspect.js',
);
const { id: appId } = JSON.parse(readFileSync(resolve(root, 'public', 'appinfo.json'), 'utf-8'));
const URL_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 1000;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function killTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    // ares-inspect spawns helpers; /T takes the whole tree down.
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill();
  }
}

function waitForInspectorUrl(child) {
  return new Promise((resolveUrl, reject) => {
    let output = '';
    const timer = setTimeout(
      () => reject(new Error(`No inspector URL from ares-inspect after 30 s. Output:\n${output}`)),
      URL_TIMEOUT_MS,
    );
    const onData = (chunk) => {
      output += chunk.toString();
      const url = parseInspectorUrl(output);
      if (url) {
        clearTimeout(timer);
        resolveUrl(url);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`ares-inspect exited with code ${code}. Output:\n${output}`));
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function fetchTargets(baseUrl) {
  let lastError;
  for (const path of ['/json/list', '/json']) {
    try {
      const response = await fetch(baseUrl + path);
      if (response.ok) return await response.json();
      lastError = new Error(`${path} answered ${response.status}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function openSocket(url) {
  return new Promise((resolveSocket, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener('open', () => resolveSocket(socket), { once: true });
    socket.addEventListener('error', () => reject(new Error(`Cannot connect to ${url}`)), {
      once: true,
    });
  });
}

async function main(args, child) {
  const baseUrl = await waitForInspectorUrl(child);
  const target = pickTarget(await fetchTargets(baseUrl), appId);
  if (!target?.webSocketDebuggerUrl) throw new Error('No debuggable page found on the TV');
  const socket = await openSocket(target.webSocketDebuggerUrl);
  try {
    const cdp = createCdpClient(socket);
    const deadline = Date.now() + args.timeoutSec * 1000;
    let lastError = null;
    for (;;) {
      try {
        if (await cdp.evaluate(args.waitFor)) break;
        lastError = null;
      } catch (error) {
        // The page may still be loading; keep polling until the deadline.
        lastError = error;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out after ${args.timeoutSec} s waiting for: ${args.waitFor}` +
            (lastError ? ` (last error: ${lastError.message})` : ''),
        );
      }
      await sleep(POLL_INTERVAL_MS);
    }
    const text = formatValue(await cdp.evaluate(args.expression));
    console.log(text);
    if (args.out) writeFileSync(resolve(args.out), text + '\n');
  } finally {
    socket.close();
  }
}

let child;
let exitCode = 0;
try {
  const args = parseArgs(process.argv.slice(2), process.env);
  // Entry point through node, no shell. ares-inspect only opens a browser with --open.
  child = spawn(process.execPath, [inspectScript, '-d', args.device, '-a', appId], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  process.on('SIGINT', () => {
    killTree(child);
    process.exit(130);
  });
  await main(args, child);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exitCode = 1;
} finally {
  if (child) killTree(child);
}
process.exit(exitCode);
