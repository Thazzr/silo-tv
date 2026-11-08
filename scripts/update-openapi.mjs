// Downloads the Silo OpenAPI spec and writes the slim, host-free copy to openapi/silo-v2.json.
// Usage: SILO_SERVER=https://your.silo.example npm run openapi:update
import { readFileSync, writeFileSync } from 'node:fs';
import { assertNoHost, filterSpec, serializeSpec } from './openapi-filter.mjs';

const root = new URL('../', import.meta.url);

const server = process.env.SILO_SERVER;
if (!server) {
  console.error(
    'SILO_SERVER is not set. Example: SILO_SERVER=https://silo.example npm run openapi:update',
  );
  process.exit(2);
}
let origin;
try {
  origin = new URL(server).origin;
} catch {
  console.error('SILO_SERVER is not a valid URL.');
  process.exit(2);
}

const response = await fetch(`${origin}/api/v2/openapi.json`);
if (!response.ok) {
  console.error(`Downloading the spec failed with HTTP ${response.status}.`);
  process.exit(1);
}
const full = await response.json();
const allowlist = JSON.parse(readFileSync(new URL('openapi/operations.json', root), 'utf-8'));

const output = serializeSpec(filterSpec(full, allowlist));
assertNoHost(output, origin);
writeFileSync(new URL('openapi/silo-v2.json', root), output);
console.log(`Wrote openapi/silo-v2.json (${allowlist.length} operations).`);
