/** Parses a JSON object string; anything else (garbage, arrays, scalars) is an empty object. */
export function parseObject(raw: string | undefined): Record<string, unknown> {
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

/** The page's query string as an object (browser, Playwright, and a webOS launch with a URL). */
export function queryParams(): Record<string, unknown> {
  return Object.fromEntries(new URLSearchParams(window.location.search));
}
