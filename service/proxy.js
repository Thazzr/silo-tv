'use strict';
// Logic of the webOS JS service. Plain CommonJS, ES2019 at most, no dependencies: it runs on the
// TV's own (possibly old) Node.js. Request headers and bodies carry tokens and are never logged.

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];
const API_PREFIX = '/api/v2/';
const FORWARDED_RESPONSE_HEADERS = [
  'content-type',
  'etag',
  'retry-after',
  'location',
  'www-authenticate',
];

// Hop-by-hop and framing headers the caller must not control; Content-Length is set from the body.
const STRIPPED_REQUEST_HEADERS = [
  'host',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
];

/** @param {string} errorText */
function fail(errorText) {
  return { returnValue: false, errorText: errorText };
}

/**
 * The app ID is the service ID without its ".service" suffix. The single place that derives it.
 * @param {string} serviceName
 */
function appIdOf(serviceName) {
  return serviceName.replace(/\.service$/, '');
}

/**
 * Only our own app may call fetch. `sender` is the app ID of the caller; some webOS versions
 * append a process id ("<appId> 1234"), which is accepted too. Anything else, including an ID
 * that merely starts with ours, is refused.
 * @param {unknown} sender
 * @param {string} appId
 */
function isAllowedCaller(sender, appId) {
  if (typeof sender !== 'string' || !appId) return false;
  if (sender === appId) return true;
  return sender.indexOf(appId + ' ') === 0 && /^[0-9]+$/.test(sender.slice(appId.length + 1));
}

/**
 * @param {number} a
 * @param {number} b
 */
function isBlockedIPv4(a, b) {
  // 127/8 is the TV itself, 0/8 means "this host", 169.254/16 is link-local.
  // Private LAN ranges (10/8, 172.16/12, 192.168/16) are deliberately NOT blocked: Silo servers
  // usually live there.
  return a === 127 || a === 0 || (a === 169 && b === 254);
}

/**
 * Parses an IPv6 literal (no brackets) into eight 16-bit groups, or null. Accepts "::" and a
 * dotted IPv4 tail ("::ffff:127.0.0.1").
 * @param {string} text
 * @returns {number[] | null}
 */
function parseIPv6(text) {
  let head = text;
  const lastColon = head.lastIndexOf(':');
  const dotted = head.slice(lastColon + 1);
  if (dotted.indexOf('.') !== -1) {
    const parts = dotted.split('.');
    if (parts.length !== 4) return null;
    const nums = parts.map(function (p) {
      return /^[0-9]{1,3}$/.test(p) ? Number(p) : NaN;
    });
    if (
      nums.some(function (n) {
        return !(n >= 0 && n <= 255);
      })
    ) {
      return null;
    }
    head =
      head.slice(0, lastColon + 1) +
      (nums[0] * 256 + nums[1]).toString(16) +
      ':' +
      (nums[2] * 256 + nums[3]).toString(16);
  }
  const halves = head.split('::');
  if (halves.length > 2) return null;
  /** @param {string} s */
  const groups = function (s) {
    return s === '' ? [] : s.split(':');
  };
  const left = groups(halves[0]);
  const right = halves.length === 2 ? groups(halves[1]) : [];
  if (halves.length === 1 && left.length !== 8) return null;
  const missing = 8 - left.length - right.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const all = left.concat(new Array(halves.length === 2 ? missing : 0).fill('0'), right);
  const nums16 = all.map(function (g) {
    return /^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN;
  });
  if (nums16.some(isNaN)) return null;
  return nums16;
}

/**
 * True for hosts that must not be reachable through the proxy: the TV itself and link-local
 * targets. Takes a host name or IP literal as in URL.hostname (IPv6 may be bracketed).
 * Private LAN ranges (10/8, 172.16/12, 192.168/16, fc00::/7) stay allowed on purpose.
 * @param {string} host
 */
function isBlockedHost(host) {
  let h = host.toLowerCase();
  if (h.charAt(0) === '[' && h.charAt(h.length - 1) === ']') h = h.slice(1, -1);
  if (h.charAt(h.length - 1) === '.') h = h.slice(0, -1);
  if (h === 'localhost' || /\.localhost$/.test(h)) return true;

  const v4 = /^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$/.exec(h);
  if (v4) return isBlockedIPv4(Number(v4[1]), Number(v4[2]));

  if (h.indexOf(':') !== -1) {
    const g = parseIPv6(h);
    if (!g) return true; // unparsable literal: refuse rather than guess
    const zeroPrefix = g.slice(0, 5).every(function (x) {
      return x === 0;
    });
    if (zeroPrefix && g[5] === 0 && g[6] === 0 && (g[7] === 0 || g[7] === 1)) return true; // :: and ::1
    if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10
    // IPv4-mapped (::ffff:a.b.c.d) and the deprecated IPv4-compatible (::a.b.c.d) forms.
    if (zeroPrefix && (g[5] === 0xffff || g[5] === 0)) return isBlockedIPv4(g[6] >> 8, g[6] & 0xff);
  }
  return false;
}

/**
 * Wraps a dns.lookup-style function so a name that resolves to a blocked address fails.
 * Uses the callback API only, which exists on old Node versions.
 * @param {Function} realLookup
 */
function createGuardedLookup(realLookup) {
  /**
   * @param {string} hostname
   * @param {any} options
   * @param {Function} [callback]
   */
  return function (hostname, options, callback) {
    let opts = options;
    let cb = callback;
    if (typeof opts === 'function') {
      cb = opts;
      opts = {};
    }
    realLookup(
      hostname,
      opts,
      function (/** @type {any} */ err, /** @type {any} */ address, /** @type {any} */ family) {
        if (err) return /** @type {Function} */ (cb)(err);
        const list = Array.isArray(address) ? address : [{ address: address }];
        for (let i = 0; i < list.length; i++) {
          if (isBlockedHost(String(list[i].address))) {
            return /** @type {Function} */ (cb)(new Error('host resolves to a blocked address'));
          }
        }
        return /** @type {Function} */ (cb)(null, address, family);
      },
    );
  };
}

/**
 * Raw path of a URL string as given (before normalisation): from the end of the scheme to the
 * first "?" or "#". The authority is included, which only makes the check stricter.
 * @param {string} raw
 */
function rawPathOf(raw) {
  const schemeEnd = raw.indexOf('://');
  const rest = schemeEnd === -1 ? raw : raw.slice(schemeEnd + 3);
  const end = rest.search(/[?#]/);
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * Copies the caller's headers minus the ones that must not be forwarded.
 * @param {any} headers
 * @returns {Record<string, string>}
 */
function sanitizeHeaders(headers) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!headers || typeof headers !== 'object') return out;
  Object.keys(headers).forEach(function (name) {
    if (STRIPPED_REQUEST_HEADERS.indexOf(name.toLowerCase()) === -1) out[name] = headers[name];
  });
  return out;
}

/**
 * Validates a fetch request. Returns { error } or { error: null, url, method }.
 * The path restriction keeps the service from becoming a general proxy for other apps on the TV.
 * @param {any} params
 * @returns {{ error: string, url?: undefined, method?: undefined } | { error: null, url: URL, method: string }}
 */
function validateRequest(params) {
  if (!params || typeof params.url !== 'string') return { error: 'url is required' };
  let url;
  try {
    url = new URL(params.url);
  } catch {
    return { error: 'url is not valid' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { error: 'only http and https URLs are allowed' };
  }
  if (isBlockedHost(url.hostname)) {
    return { error: 'requests to this host are not allowed' };
  }
  // Checked on the raw path: URL normalisation would hide a smuggled "\" or "%2f" from the prefix
  // check below while the upstream server may still decode it into a different path.
  if (/\\|%2f|%5c/i.test(rawPathOf(params.url))) {
    return { error: 'path must not contain backslashes or encoded slashes' };
  }
  if (url.pathname.indexOf(API_PREFIX) !== 0) {
    return { error: 'only paths below ' + API_PREFIX + ' are allowed' };
  }
  const method = String(params.method || 'GET').toUpperCase();
  if (ALLOWED_METHODS.indexOf(method) === -1) {
    return { error: 'method ' + method + ' is not allowed' };
  }
  return { error: null, url: url, method: method };
}

/**
 * @param {{ http: { request: Function }, https: { request: Function } }} [transports]
 *   injectable for tests; defaults to the Node modules
 * @param {{ lookup?: Function }} [deps] `lookup` (dns.lookup signature) is injectable for tests
 */
function createProxy(transports, deps) {
  const transport = transports || { http: require('http'), https: require('https') };
  const lookup = createGuardedLookup((deps && deps.lookup) || require('dns').lookup);

  /** @param {any} params */
  function doFetch(params) {
    const checked = validateRequest(params);
    if (checked.url === undefined) return Promise.resolve(fail(checked.error));
    const url = checked.url;
    const timeoutMs =
      typeof params.timeoutMs === 'number' && params.timeoutMs > 0
        ? params.timeoutMs
        : DEFAULT_TIMEOUT_MS;
    const lib = url.protocol === 'https:' ? transport.https : transport.http;

    return new Promise(function (resolve) {
      let settled = false;
      /** @type {any} */
      let req = null;
      /** @param {object} result */
      const finish = function (result) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      /** @param {object} result */
      const abort = function (result) {
        finish(result);
        if (req) req.destroy();
      };
      const timer = setTimeout(function () {
        abort(fail('request timed out after ' + timeoutMs + ' ms'));
      }, timeoutMs);

      const headers = sanitizeHeaders(params.headers);
      const hasBody = params.body !== undefined && params.body !== null;
      const body = hasBody ? String(params.body) : '';
      if (hasBody) headers['Content-Length'] = String(Buffer.byteLength(body));
      const options = {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: url.pathname + url.search,
        method: checked.method,
        headers: headers,
        // Blocks names that resolve to the TV itself or a link-local address (DNS rebinding).
        lookup: lookup,
      };

      try {
        req = lib.request(options, function (/** @type {any} */ res) {
          /** @type {Buffer[]} */
          const chunks = [];
          let size = 0;
          res.on('data', function (/** @type {Buffer} */ chunk) {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
              abort(fail('response body exceeds ' + MAX_BODY_BYTES + ' bytes'));
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', function () {
            /** @type {Record<string, string>} */
            const headers = {};
            FORWARDED_RESPONSE_HEADERS.forEach(function (name) {
              const value = res.headers && res.headers[name];
              if (value !== undefined)
                headers[name] = Array.isArray(value) ? value.join(', ') : value;
            });
            finish({
              returnValue: true,
              status: res.statusCode,
              statusText: res.statusMessage || '',
              headers: headers,
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
          res.on('error', function (/** @type {Error} */ error) {
            finish(fail(error.message));
          });
        });
        req.on('error', function (/** @type {Error} */ error) {
          finish(fail(error.message));
        });
        if (hasBody) req.write(body);
        req.end();
      } catch (error) {
        finish(fail(error instanceof Error ? error.message : String(error)));
      }
    });
  }

  return { fetch: doFetch };
}

/**
 * The bus-facing handlers, kept out of index.js so the caller check is testable without webOS.
 * @param {{ appId: string, proxy: { fetch: (params: any) => Promise<Record<string, unknown>> } }} deps
 */
function createHandlers(deps) {
  return {
    /** @param {{ sender?: string, payload?: any }} message */
    fetch: function (message) {
      if (!isAllowedCaller(message.sender, deps.appId)) {
        return Promise.resolve(fail('caller not allowed'));
      }
      return deps.proxy
        .fetch(message.payload || {})
        .then(null, function (/** @type {any} */ error) {
          return fail(String((error && error.message) || error));
        });
    },
    // Open to every caller on purpose; it exposes the sender as received so the real format can be
    // checked on the TV. Nothing else.
    /** @param {{ sender?: string }} message */
    ping: function (message) {
      return { returnValue: true, node: process.version, sender: message.sender };
    },
  };
}

module.exports = {
  createProxy: createProxy,
  createHandlers: createHandlers,
  isAllowedCaller: isAllowedCaller,
  isBlockedHost: isBlockedHost,
  createGuardedLookup: createGuardedLookup,
  appIdOf: appIdOf,
  validateRequest: validateRequest,
  DEFAULT_TIMEOUT_MS: DEFAULT_TIMEOUT_MS,
  MAX_BODY_BYTES: MAX_BODY_BYTES,
};
