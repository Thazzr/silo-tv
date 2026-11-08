// Pure check functions for the shipped bundle. Each returns a list of violation messages.

export const REQUIRED_DIST_FILES = ['appinfo.json', 'icon.png', 'largeIcon.png'];

export function checkHtml(html) {
  const violations = [];
  if (/type\s*=\s*["']?module/i.test(html)) {
    violations.push('index.html contains type="module"; webOS blocks module scripts under file://');
  }
  if (/\bcrossorigin\b/i.test(html)) {
    violations.push('index.html contains a crossorigin attribute');
  }
  for (const [, attrs] of html.matchAll(/<script\b([^>]*)>/gi)) {
    const src = /\ssrc\s*=\s*["']([^"']*)["']/i.exec(` ${attrs}`)?.[1];
    if (src === undefined) continue;
    checkReference(violations, `script src "${src}"`, src);
    if (!/\sdefer\b/i.test(` ${attrs}`)) {
      violations.push(`script "${src}" has no defer attribute`);
    }
  }
  for (const [, attrs] of html.matchAll(/<link\b([^>]*)>/gi)) {
    const href = /\shref\s*=\s*["']([^"']*)["']/i.exec(` ${attrs}`)?.[1];
    if (href !== undefined) checkReference(violations, `link href "${href}"`, href);
  }
  return violations;
}

function checkReference(violations, label, value) {
  if (value.startsWith('/') || /^https?:/i.test(value)) {
    violations.push(`${label} is not relative; it must not start with "/" or "http"`);
  }
}

/** @param {string[]} fileNames paths of all files in dist, relative to dist */
export function checkDistFiles(fileNames) {
  const violations = [];
  for (const required of REQUIRED_DIST_FILES) {
    if (!fileNames.includes(required)) violations.push(`dist is missing ${required}`);
  }
  const scripts = fileNames.filter((name) => name.endsWith('.js'));
  if (scripts.length !== 1) {
    violations.push(
      `dist must contain exactly one .js file (no chunks), found ${scripts.length}: ${scripts.join(', ') || '-'}`,
    );
  }
  return violations;
}

export function checkVersions(appinfoVersion, packageVersion) {
  return appinfoVersion === packageVersion
    ? []
    : [
        `appinfo.json version ${appinfoVersion} differs from package.json version ${packageVersion}`,
      ];
}

/**
 * The service id must be "<app id>.service" in services.json (id and service names) and in the
 * service's package.json name; webOS addresses the service by this id.
 */
export function checkServiceIds(appId, servicesJson, packageJson) {
  const expected = `${appId}.service`;
  const violations = [];
  if (servicesJson?.id !== expected) {
    violations.push(`service/services.json id "${servicesJson?.id}" must be "${expected}"`);
  }
  const names = (servicesJson?.services ?? []).map((service) => service.name);
  if (names.length === 0 || names.some((name) => name !== expected)) {
    violations.push(
      `service/services.json service names [${names.join(', ')}] must all be "${expected}"`,
    );
  }
  if (packageJson?.name !== expected) {
    violations.push(`service/package.json name "${packageJson?.name}" must be "${expected}"`);
  }
  return violations;
}

/** es-check target files of the service: every .js file except tests. */
export function serviceSourceFiles(fileNames) {
  return fileNames.filter((name) => name.endsWith('.js') && !/\.test\.[cm]?[jt]s$/.test(name));
}

/** Tests live in tests/; anything test-like inside service/ would be packaged onto the TV. */
export function checkNoServiceTests(fileNames) {
  return fileNames
    .filter((name) => /\.(test|spec)\./.test(name))
    .map((name) => `service/${name} is a test file; tests belong in tests/, not in the package`);
}
