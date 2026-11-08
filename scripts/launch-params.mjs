// Launch parameters for the app, built from environment variables. Only what is set ends up in
// the object: SILO_SERVER -> server, PROBE=1 -> probe: true, TRANSPORT=direct|service -> transport.
const TRANSPORTS = new Set(['direct', 'service']);

export function buildLaunchParams(env) {
  const params = {};
  const server = env.SILO_SERVER?.trim();
  if (server) params.server = server;
  const probe = env.PROBE?.trim().toLowerCase();
  if (probe && !['0', 'false', 'no', 'off'].includes(probe)) params.probe = true;
  const transport = env.TRANSPORT?.trim();
  if (transport) {
    if (!TRANSPORTS.has(transport)) {
      throw new Error(`TRANSPORT must be "direct" or "service", got "${transport}"`);
    }
    params.transport = transport;
  }
  return params;
}
