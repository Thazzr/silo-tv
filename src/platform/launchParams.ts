function parseObject(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Launch parameters from webOS merged with the page's query string (browser, Playwright).
 * Query parameters win on conflict.
 */
export function readLaunchParams(): Record<string, unknown> {
  const fromSystem = parseObject(
    window.webOSSystem?.launchParams ?? window.PalmSystem?.launchParams,
  );
  const fromQuery = Object.fromEntries(new URLSearchParams(window.location.search));
  return { ...fromSystem, ...fromQuery };
}
