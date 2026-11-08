import { directTransport } from './direct';
import { serviceTransport } from './service';
import type { Transport, TransportMode } from './types';

export type { Transport, TransportMode } from './types';
export { directTransport } from './direct';
export { serviceTransport } from './service';

export function selectTransport(mode: TransportMode): Transport {
  return mode === 'service' ? serviceTransport : directTransport;
}

// Default is direct for now; the TV probe decides which mode ships.
let currentMode: TransportMode = 'direct';

export function setTransportMode(mode: TransportMode): void {
  currentMode = mode;
}

export function getTransportMode(): TransportMode {
  return currentMode;
}

/** A transport that follows the current mode at call time, so a mode switch needs no new client. */
export const currentTransport: Transport = (request) => selectTransport(currentMode)(request);
