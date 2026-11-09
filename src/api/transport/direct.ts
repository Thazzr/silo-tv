import { withTimeout } from './timeout';
import type { Transport } from './types';

/**
 * Plain browser fetch with a timeout. Cookies are never sent: the API authenticates with bearer
 * tokens.
 */
export const directTransport: Transport = (request) =>
  withTimeout(request.signal, (signal) => fetch(request, { credentials: 'omit', signal }));
