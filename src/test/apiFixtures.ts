// Typed fixtures for API tests. They are typed against the generated schema, so a spec change
// that alters these shapes breaks the build instead of silently passing.
import type { components } from '../api/generated/schema';

export const BASE_URL = 'https://silo.example.test';

export const account: components['schemas']['Account'] = {
  download_allowed: true,
  email: 'viewer@example.test',
  id: 'user-1',
  password_change_required: false,
  permissions: [],
  role: 'user',
  username: 'viewer',
};

export const systemInfo: components['schemas']['SystemInfo'] = {
  api_major: 2,
  contract_digest: 'abc',
  links: {
    capabilities: '/api/v2/capabilities',
    identity: '/api/v2/system/identity',
    openapi: '/api/v2/openapi.json',
  },
  server_version: 'test',
};

export function problem(code: string, status: number): components['schemas']['Problem'] {
  return {
    type: `https://siloserver.org/docs/api/v2/problems/${code}`,
    title: code,
    status,
    detail: `${code} detail`,
    instance: 'urn:silo:request:1',
  };
}

/** A JSON problem+json response like Silo's. */
export function problemResponse(code: string, status: number, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(problem(code, status)), {
    status,
    headers: { 'Content-Type': 'application/problem+json', ...headers },
  });
}
