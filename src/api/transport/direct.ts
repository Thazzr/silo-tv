import type { Transport } from './types';

/** Plain browser fetch. Cookies are never sent: the API authenticates with bearer tokens. */
export const directTransport: Transport = (request) => fetch(request, { credentials: 'omit' });
