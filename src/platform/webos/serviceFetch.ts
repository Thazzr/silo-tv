import type { ProxyFetchRequest, ProxyFetchResponse, ProxyPingResponse } from '../types';
import { lunaCall } from './luna';

/** The app ID is the single source; the JS service id is derived from it. */
export const APP_ID = 'io.github.thazzr.silotv';
export const SERVICE_ID = `${APP_ID}.service`;

// The service's own timeout (default 15 s) must fire before the bridge gives up.
const BRIDGE_MARGIN_MS = 5000;
const SERVICE_DEFAULT_TIMEOUT_MS = 15000;

export function serviceFetch(req: ProxyFetchRequest): Promise<ProxyFetchResponse> {
  const timeoutMs = (req.timeoutMs ?? SERVICE_DEFAULT_TIMEOUT_MS) + BRIDGE_MARGIN_MS;
  return lunaCall<ProxyFetchResponse>(`luna://${SERVICE_ID}/fetch`, req, { timeoutMs });
}

export function servicePing(): Promise<ProxyPingResponse> {
  return lunaCall<ProxyPingResponse>(`luna://${SERVICE_ID}/ping`, {});
}
