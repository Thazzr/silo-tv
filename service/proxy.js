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

/** @param {string} errorText */
function fail(errorText) {
  return { returnValue: false, errorText: errorText };
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
 */
function createProxy(transports) {
  const transport = transports || { http: require('http'), https: require('https') };

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

      const options = {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: url.pathname + url.search,
        method: checked.method,
        headers: params.headers || {},
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
        if (params.body !== undefined && params.body !== null) req.write(String(params.body));
        req.end();
      } catch (error) {
        finish(fail(error instanceof Error ? error.message : String(error)));
      }
    });
  }

  return {
    fetch: doFetch,
    ping: function () {
      return { returnValue: true, node: process.version };
    },
  };
}

module.exports = {
  createProxy: createProxy,
  validateRequest: validateRequest,
  DEFAULT_TIMEOUT_MS: DEFAULT_TIMEOUT_MS,
  MAX_BODY_BYTES: MAX_BODY_BYTES,
};
