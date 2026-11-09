// Pure helpers for scripts/tv-eval.mjs: argument parsing, ares-inspect output parsing, target
// selection and a small Chrome DevTools Protocol client over an injected socket, plus the shared
// connection to the app's Web Inspector (used by tv-eval.mjs and tv-profile.mjs).
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

export const DEFAULT_EXPRESSION = 'JSON.stringify(window.__SILO_PROBE__ || null)';
export const DEFAULT_WAIT_FOR = 'window.__SILO_PROBE__ && window.__SILO_PROBE__.done';
export const DEFAULT_TIMEOUT_SECONDS = 60;

const VALUE_FLAGS = {
  '--wait-for': 'waitFor',
  '--timeout': 'timeoutSec',
  '--device': 'device',
  '--out': 'out',
};

/**
 * @param {string[]} argv arguments after the script name
 * @param {Record<string, string | undefined>} [env]
 */
export function parseArgs(argv, env = {}) {
  const result = {
    expression: DEFAULT_EXPRESSION,
    waitFor: DEFAULT_WAIT_FOR,
    timeoutSec: DEFAULT_TIMEOUT_SECONDS,
    device: env.WEBOS_DEVICE || 'tv',
    out: null,
  };
  let positional = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const key = VALUE_FLAGS[arg];
    if (key) {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      if (key === 'timeoutSec') {
        const seconds = Number(value);
        if (!Number.isFinite(seconds) || seconds <= 0) {
          throw new Error(`--timeout needs a positive number of seconds, got "${value}"`);
        }
        result.timeoutSec = seconds;
      } else {
        result[key] = value;
      }
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option ${arg}`);
    } else if (positional === null) {
      positional = arg;
    } else {
      throw new Error(`Unexpected extra argument "${arg}"; quote the expression`);
    }
  }
  if (positional !== null) result.expression = positional;
  return result;
}

/** First http://host:port in ares-inspect output, without any path; null when there is none. */
export function parseInspectorUrl(text) {
  const match = /https?:\/\/[^\s:/]+:\d+/.exec(text);
  return match ? match[0] : null;
}

/**
 * Chooses the DevTools target of the app: a page whose url mentions index.html or the app id,
 * else the first page.
 */
export function pickTarget(targets, appId) {
  const pages = (Array.isArray(targets) ? targets : []).filter((t) => t && t.type === 'page');
  const own = pages.find(
    (t) => typeof t.url === 'string' && (t.url.includes('index.html') || t.url.includes(appId)),
  );
  return own ?? pages[0] ?? null;
}

/** Pretty-prints JSON strings, serialises other values, prints undefined as such. */
export function formatValue(value) {
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  if (value === undefined) return 'undefined';
  return JSON.stringify(value, null, 2);
}

/**
 * CDP client over a WebSocket-like object (send, addEventListener('message'|'close'|'error')).
 * Requests are correlated with responses by id.
 */
export function createCdpClient(socket, { requestTimeoutMs = 15000 } = {}) {
  let nextId = 1;
  const pending = new Map();

  const rejectAll = (error) => {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    pending.clear();
  };

  socket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
    } catch {
      return;
    }
    const entry = pending.get(message.id);
    if (!entry) return; // events and unknown ids
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) {
      entry.reject(new Error(`${entry.method}: ${message.error.message ?? 'CDP error'}`));
    } else {
      entry.resolve(message.result);
    }
  });
  socket.addEventListener('close', () => rejectAll(new Error('DevTools connection closed')));
  socket.addEventListener('error', () => rejectAll(new Error('DevTools connection error')));

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method}: no response after ${requestTimeoutMs} ms`));
      }, requestTimeoutMs);
      pending.set(id, { resolve, reject, timer, method });
      try {
        socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  /** Evaluates an expression in the page and returns its value; a thrown error rejects. */
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      const details = result.exceptionDetails;
      throw new Error(
        `Evaluation failed: ${details.exception?.description ?? details.text ?? 'exception'}`,
      );
    }
    return result.result?.value;
  }

  return { send, evaluate };
}

const URL_TIMEOUT_MS = 30_000;

export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

export function killTree(child) {
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

/**
 * Starts ares-inspect for the app on the device and returns { child, connect }. `connect()` waits
 * for the inspector URL, picks the app's page and returns { cdp, socket }
 * (cdpOptions go to createCdpClient). Callers must
 * killTree(child) when done.
 */
export function startInspector({ root, device, appId }) {
  const inspectScript = resolve(
    root,
    'node_modules',
    '@webos-tools',
    'cli',
    'bin',
    'ares-inspect.js',
  );
  // Entry point through node, no shell. ares-inspect only opens a browser with --open.
  const child = spawn(process.execPath, [inspectScript, '-d', device, '-a', appId], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  async function connect(cdpOptions) {
    const baseUrl = await waitForInspectorUrl(child);
    const target = pickTarget(await fetchTargets(baseUrl), appId);
    if (!target?.webSocketDebuggerUrl) throw new Error('No debuggable page found on the TV');
    const socket = await openSocket(target.webSocketDebuggerUrl);
    return { cdp: createCdpClient(socket, cdpOptions), socket };
  }
  return { child, connect };
}

/** Polls `expression` until truthy; throws after timeoutSec. */
export async function waitUntil(cdp, expression, timeoutSec, pollMs = 1000) {
  const deadline = Date.now() + timeoutSec * 1000;
  let lastError = null;
  for (;;) {
    try {
      if (await cdp.evaluate(expression)) return;
    } catch (error) {
      // The page may still be loading; keep polling until the deadline.
      lastError = error;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out after ${timeoutSec} s waiting for: ${expression}` +
          (lastError ? ` (last error: ${lastError.message})` : ''),
      );
    }
    await sleep(pollMs);
  }
}

// ---- CPU profiles (scripts/tv-profile.mjs) ----

export const PROFILE_DEFAULTS = { seconds: 20, intervalUs: 1000 };

const PROFILE_FLAGS = ['--seconds', '--interval', '--out', '--device', '--wait-for', '--timeout'];

/**
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} [env]
 * @param {Date} [now] only for the default file name
 */
export function parseProfileArgs(argv, env = {}, now = new Date()) {
  const result = {
    seconds: PROFILE_DEFAULTS.seconds,
    intervalUs: PROFILE_DEFAULTS.intervalUs,
    out: null,
    device: env.WEBOS_DEVICE || 'tv',
    waitFor: null,
    timeoutSec: DEFAULT_TIMEOUT_SECONDS,
  };
  const positive = (flag, value) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`${flag} needs a positive number, got "${value}"`);
    }
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument "${arg}"`);
    if (!PROFILE_FLAGS.includes(arg)) throw new Error(`Unknown option ${arg}`);
    const value = argv[++i];
    if (value === undefined) throw new Error(`${arg} needs a value`);
    if (arg === '--seconds') result.seconds = positive(arg, value);
    else if (arg === '--interval') result.intervalUs = Math.round(positive(arg, value));
    else if (arg === '--timeout') result.timeoutSec = positive(arg, value);
    else if (arg === '--out') result.out = value;
    else if (arg === '--device') result.device = value;
    else result.waitFor = value;
  }
  if (!result.out) {
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    result.out = `perf-results/tv-${stamp}.cpuprofile`;
  }
  return result;
}

const basename = (url) => {
  if (!url) return '';
  const clean = url.split(/[?#]/)[0];
  return clean.slice(clean.lastIndexOf('/') + 1);
};

/**
 * Summarises a Chrome .cpuprofile ({ nodes, samples, timeDeltas }). Pure.
 * Self time goes to the sampled node, total time to every distinct function on its stack
 * (counted once per sample, so recursion does not inflate it). Times are in milliseconds; the
 * duration of sample i is timeDeltas[i + 1] (the gap to the next sample), the last one reuses its
 * own delta.
 */
export function summarizeCpuProfile(profile, { topSelf = 25, topTotal = 15 } = {}) {
  const nodes = new Map();
  for (const node of profile.nodes ?? []) nodes.set(node.id, node);
  const parent = new Map();
  for (const node of nodes.values()) {
    for (const childId of node.children ?? []) parent.set(childId, node.id);
  }
  const keyOf = (node) => {
    const f = node.callFrame ?? {};
    return `${f.functionName || '(anonymous)'}@${f.url ?? ''}:${f.lineNumber ?? 0}`;
  };
  const infoOf = (node) => {
    const f = node.callFrame ?? {};
    return {
      name: f.functionName || '(anonymous)',
      file: basename(f.url),
      line: (f.lineNumber ?? 0) + 1,
    };
  };
  const self = new Map();
  const total = new Map();
  const perFile = new Map();
  const infos = new Map();
  let totalMs = 0;
  let idleMs = 0;
  let programMs = 0;
  let gcMs = 0;
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  for (let i = 0; i < samples.length; i++) {
    const node = nodes.get(samples[i]);
    if (!node) continue;
    const ms = (deltas[i + 1] ?? deltas[i] ?? 0) / 1000;
    totalMs += ms;
    const name = node.callFrame?.functionName;
    if (name === '(idle)') idleMs += ms;
    else if (name === '(program)') programMs += ms;
    else if (name === '(garbage collector)') gcMs += ms;
    const selfKey = keyOf(node);
    infos.set(selfKey, infoOf(node));
    self.set(selfKey, (self.get(selfKey) ?? 0) + ms);
    const file = basename(node.callFrame?.url) || '(native)';
    perFile.set(file, (perFile.get(file) ?? 0) + ms);
    const seen = new Set();
    for (let id = node.id; id !== undefined; id = parent.get(id)) {
      const n = nodes.get(id);
      if (!n) break;
      const key = keyOf(n);
      infos.set(key, infoOf(n));
      if (seen.has(key)) continue;
      seen.add(key);
      total.set(key, (total.get(key) ?? 0) + ms);
    }
  }
  const percentOf = (ms) => (totalMs > 0 ? (ms / totalMs) * 100 : 0);
  const rank = (map, limit) =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([key, ms]) => ({ ...infos.get(key), ms, percent: percentOf(ms) }));
  return {
    totalMs,
    idleMs,
    programMs,
    gcMs,
    topSelf: rank(self, topSelf),
    topTotal: rank(total, topTotal),
    files: [...perFile.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([file, ms]) => ({ file, ms, percent: percentOf(ms) })),
  };
}

/** Plain-text rendering of summarizeCpuProfile's result. */
export function formatCpuProfileSummary(summary) {
  const f = (n) => n.toFixed(1);
  const row = (e) =>
    `${f(e.ms).padStart(9)} ms ${f(e.percent).padStart(5)} %  ${e.name} (${e.file}:${e.line})`;
  return [
    `Sampled ${f(summary.totalMs)} ms: idle ${f(summary.idleMs)}, (program) ${f(summary.programMs)}, (garbage collector) ${f(summary.gcMs)}`,
    '',
    'Top functions by self time',
    ...summary.topSelf.map(row),
    '',
    'Top functions by total time (inclusive)',
    ...summary.topTotal.map(row),
    '',
    'Self time per file',
    ...summary.files.map(
      (e) => `${f(e.ms).padStart(9)} ms ${f(e.percent).padStart(5)} %  ${e.file}`,
    ),
  ].join('\n');
}
