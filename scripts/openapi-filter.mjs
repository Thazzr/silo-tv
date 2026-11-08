// Pure filter logic for the slim OpenAPI spec (no I/O, so it can be tested on its own).

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
const COMPONENT_REF = /^#\/components\/([^/]+)\/(.+)$/;

/** Recursively sorts object keys so the written file is stable across runs. */
export function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys(value[key])]),
    );
  }
  return value;
}

/** Removes every `servers` member: they name the host the spec was downloaded from. */
function stripServers(value) {
  if (Array.isArray(value)) return value.map(stripServers);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'servers')
        .map(([key, child]) => [key, stripServers(child)]),
    );
  }
  return value;
}

function collectRefs(value, into) {
  if (Array.isArray(value)) {
    for (const child of value) collectRefs(child, into);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key === '$ref' && typeof child === 'string') into.add(child);
      else collectRefs(child, into);
    }
  }
}

/**
 * Keeps only the allowlisted operations and the components they reference, directly or through
 * other components. `allowlist` is a list of { path, method }.
 */
export function filterSpec(spec, allowlist) {
  const paths = {};
  for (const { path, method } of allowlist) {
    const item = spec.paths?.[path];
    const operation = item?.[method];
    if (!operation) throw new Error(`Operation ${method.toUpperCase()} ${path} is not in the spec`);
    paths[path] ??= Object.fromEntries(
      Object.entries(item).filter(([key]) => !METHODS.includes(key)),
    );
    paths[path][method] = operation;
  }

  const components = {};
  const pending = [];
  const seen = new Set();
  const enqueue = (node) => {
    const refs = new Set();
    collectRefs(node, refs);
    for (const ref of refs) {
      if (!seen.has(ref)) {
        seen.add(ref);
        pending.push(ref);
      }
    }
  };
  enqueue(paths);
  // Operations name their security schemes by key instead of by $ref.
  const schemes = new Set();
  const collectSecurity = (security) => {
    for (const requirement of security ?? []) {
      for (const name of Object.keys(requirement)) schemes.add(name);
    }
  };
  collectSecurity(spec.security);
  for (const item of Object.values(paths)) {
    for (const method of METHODS) collectSecurity(item[method]?.security);
  }
  for (const name of schemes) {
    const scheme = spec.components?.securitySchemes?.[name];
    if (scheme) (components.securitySchemes ??= {})[name] = scheme;
  }

  while (pending.length > 0) {
    const ref = pending.pop();
    const match = COMPONENT_REF.exec(ref);
    if (!match) continue;
    const [, section, name] = match;
    const target = spec.components?.[section]?.[name];
    if (target === undefined) throw new Error(`Unresolved reference ${ref}`);
    (components[section] ??= {})[name] = target;
    enqueue(target);
  }

  const result = { openapi: spec.openapi, info: spec.info, paths };
  if (spec.security) result.security = spec.security;
  if (Object.keys(components).length > 0) result.components = components;
  return sortKeys(stripServers(result));
}

/** Throws when the source host still occurs anywhere in the serialized output. */
export function assertNoHost(serialized, serverUrl) {
  const url = new URL(serverUrl);
  const needles = new Set([url.host, url.hostname, serverUrl.replace(/\/+$/, '')]);
  const text = serialized.toLowerCase();
  for (const needle of needles) {
    if (needle && text.includes(needle.toLowerCase())) {
      throw new Error('The filtered spec still contains the source host; refusing to write it');
    }
  }
}

export function serializeSpec(spec) {
  return `${JSON.stringify(spec, null, 2)}\n`;
}
