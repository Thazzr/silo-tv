import { describe, expect, it } from 'vitest';
import { assertNoHost, filterSpec, serializeSpec } from './openapi-filter.mjs';

const spec = {
  openapi: '3.1.0',
  info: { title: 'T', version: '2' },
  servers: [{ url: 'https://silo.example.test' }],
  security: [{ bearerAuth: [] }],
  'x-extension': { note: 'dropped' },
  paths: {
    '/a': {
      parameters: [{ $ref: '#/components/parameters/Shared' }],
      servers: [{ url: 'https://silo.example.test' }],
      get: {
        responses: {
          '200': {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/A' } } },
          },
        },
      },
      post: { responses: { '200': { description: 'not allowlisted' } } },
    },
    '/b': { get: { responses: { '200': { description: 'ok' } } } },
    '/c': {
      get: {
        responses: {
          '200': {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Unused' } } },
          },
        },
      },
    },
  },
  components: {
    parameters: { Shared: { name: 's', in: 'query', schema: { type: 'string' } } },
    schemas: {
      A: { type: 'object', properties: { b: { $ref: '#/components/schemas/B' } } },
      B: { type: 'array', items: { $ref: '#/components/schemas/C' } },
      C: { type: 'object', properties: { x: { type: 'string' } } },
      Unused: { type: 'string' },
      AlsoUnused: { $ref: '#/components/schemas/Unused' },
    },
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' }, other: { type: 'apiKey' } },
  },
};

describe('filterSpec', () => {
  const filtered = filterSpec(spec, [
    { path: '/a', method: 'get' },
    { path: '/b', method: 'get' },
  ]);

  it('keeps exactly the allowlisted operations', () => {
    expect(Object.keys(filtered.paths)).toEqual(['/a', '/b']);
    expect(Object.keys(filtered.paths['/a']).filter((k) => ['get', 'post'].includes(k))).toEqual([
      'get',
    ]);
  });

  it('pulls in nested $ref chains and nothing else', () => {
    expect(Object.keys(filtered.components.schemas)).toEqual(['A', 'B', 'C']);
    expect(Object.keys(filtered.components.parameters)).toEqual(['Shared']);
    expect(Object.keys(filtered.components.securitySchemes)).toEqual(['bearerAuth']);
  });

  it('removes servers everywhere and drops root extensions', () => {
    const text = JSON.stringify(filtered);
    expect(text).not.toContain('servers');
    expect(text).not.toContain('silo.example.test');
    expect(filtered['x-extension']).toBeUndefined();
  });

  it('is stable regardless of input key order', () => {
    const reversed = JSON.parse(JSON.stringify(spec), (_key, value: unknown) =>
      value !== null && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).reverse())
        : value,
    );
    const again = filterSpec(reversed, [
      { path: '/b', method: 'get' },
      { path: '/a', method: 'get' },
    ]);
    expect(serializeSpec(again)).toBe(serializeSpec(filtered));
  });

  it('fails for an operation that is not in the spec', () => {
    expect(() => filterSpec(spec, [{ path: '/a', method: 'delete' }])).toThrow(/not in the spec/);
  });

  it('fails for an unresolved reference', () => {
    const broken = {
      ...spec,
      paths: { '/z': { get: { schema: { $ref: '#/components/schemas/Nope' } } } },
    };
    expect(() => filterSpec(broken, [{ path: '/z', method: 'get' }])).toThrow(/Unresolved/);
  });
});

describe('assertNoHost', () => {
  it('throws when the host remains in the output', () => {
    expect(() =>
      assertNoHost('{"a":"see https://silo.example.test/x"}', 'https://silo.example.test'),
    ).toThrow(/source host/);
    expect(() =>
      assertNoHost('{"a":"SILO.EXAMPLE.TEST:8443"}', 'https://silo.example.test:8443'),
    ).toThrow();
  });

  it('matches case-insensitively against a mixed-case server URL', () => {
    expect(() =>
      assertNoHost('{"a":"see silo.example.test"}', 'https://Silo.Example.test'),
    ).toThrow(/source host/);
  });

  it('passes when the host is absent', () => {
    expect(() => assertNoHost('{"a":"b"}', 'https://silo.example.test')).not.toThrow();
  });
});
