// Pure helpers for scripts/tv-eval.mjs: argument parsing, ares-inspect output parsing, target
// selection and a small Chrome DevTools Protocol client over an injected socket.

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
