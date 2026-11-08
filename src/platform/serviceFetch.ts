import { lunaCall } from './luna';

/** The app ID is the single source; the JS service id is derived from it. */
export const APP_ID = 'io.github.thazzr.silolg';
export const SERVICE_ID = `${APP_ID}.service`;

export interface ServiceFetchRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface ServiceFetchResponse {
  returnValue: true;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

export interface ServicePingResponse {
  returnValue: true;
  node: string;
  /** The sender as the service received it; shows the real caller-id format on the device. */
  sender: string;
}

// The service's own timeout (default 15 s) must fire before the bridge gives up.
const BRIDGE_MARGIN_MS = 5000;
const SERVICE_DEFAULT_TIMEOUT_MS = 15000;

export function serviceFetch(req: ServiceFetchRequest): Promise<ServiceFetchResponse> {
  const timeoutMs = (req.timeoutMs ?? SERVICE_DEFAULT_TIMEOUT_MS) + BRIDGE_MARGIN_MS;
  return lunaCall<ServiceFetchResponse>(`luna://${SERVICE_ID}/fetch`, req, { timeoutMs });
}

export function servicePing(): Promise<ServicePingResponse> {
  return lunaCall<ServicePingResponse>(`luna://${SERVICE_ID}/ping`, {});
}
