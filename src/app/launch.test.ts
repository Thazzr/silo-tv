import { describe, expect, it } from 'vitest';
import { parseLaunch } from './launch';

describe('parseLaunch', () => {
  it('defaults to the app flow, direct transport and no server', () => {
    expect(parseLaunch({})).toEqual({ probe: false, transport: null, server: '' });
  });

  it.each(['', '1', 'true', 'yes', true])('treats probe=%j as set', (probe) => {
    expect(parseLaunch({ probe }).probe).toBe(true);
  });

  it.each(['0', 'false', 'off', 'NO', false, null, undefined])(
    'treats probe=%j as not set',
    (probe) => {
      expect(parseLaunch({ probe }).probe).toBe(false);
    },
  );

  it.each(['direct', 'service'] as const)('accepts transport=%s', (transport) => {
    expect(parseLaunch({ transport }).transport).toBe(transport);
  });

  it('ignores an unknown transport', () => {
    expect(parseLaunch({ transport: 'carrier-pigeon' }).transport).toBeNull();
  });

  it('trims the server and ignores a non-string server', () => {
    expect(parseLaunch({ server: ' https://silo.example.test ' }).server).toBe(
      'https://silo.example.test',
    );
    expect(parseLaunch({ server: 42 }).server).toBe('');
  });

  it('reads the query string when no params are passed', () => {
    window.history.replaceState(null, '', '/?probe&transport=service&server=silo.example.test');
    try {
      expect(parseLaunch()).toEqual({
        probe: true,
        transport: 'service',
        server: 'silo.example.test',
      });
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });
});
