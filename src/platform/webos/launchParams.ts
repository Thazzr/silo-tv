import { parseObject, queryParams } from '../shared/launchParams';

/**
 * Launch parameters from webOS merged with the page's query string (browser, Playwright).
 * Query parameters win on conflict.
 */
export function readLaunchParams(): Record<string, unknown> {
  const fromSystem = parseObject(
    window.webOSSystem?.launchParams ?? window.PalmSystem?.launchParams,
  );
  return { ...fromSystem, ...queryParams() };
}

/**
 * Calls `handler` with the new launch parameters whenever the running app is launched again
 * (webOS fires `webOSRelaunch` on `document`). The event may carry the parameters in `detail`;
 * otherwise the system object, which webOS refreshes before the event, is read again.
 */
export function onRelaunch(handler: (params: Record<string, unknown>) => void): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    const params =
      detail !== null && typeof detail === 'object' && !Array.isArray(detail)
        ? (detail as Record<string, unknown>)
        : parseObject(window.webOSSystem?.launchParams ?? window.PalmSystem?.launchParams);
    handler(params);
  };
  document.addEventListener('webOSRelaunch', listener);
  return () => document.removeEventListener('webOSRelaunch', listener);
}
