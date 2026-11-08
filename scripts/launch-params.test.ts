import { describe, expect, it } from 'vitest';
import { buildLaunchParams } from './launch-params.mjs';

describe('buildLaunchParams', () => {
  it('is empty when nothing is set', () => {
    expect(buildLaunchParams({})).toEqual({});
    expect(buildLaunchParams({ SILO_SERVER: '  ', PROBE: '', TRANSPORT: '' })).toEqual({});
  });

  it('maps each variable to its parameter', () => {
    expect(
      buildLaunchParams({
        SILO_SERVER: 'https://silo.example.test',
        PROBE: '1',
        TRANSPORT: 'service',
      }),
    ).toEqual({ server: 'https://silo.example.test', probe: true, transport: 'service' });
  });

  it('includes only what is set', () => {
    expect(buildLaunchParams({ PROBE: '1' })).toEqual({ probe: true });
    expect(buildLaunchParams({ TRANSPORT: 'direct' })).toEqual({ transport: 'direct' });
    expect(buildLaunchParams({ SILO_SERVER: 'a.example.test' })).toEqual({
      server: 'a.example.test',
    });
  });

  it.each(['0', 'false', 'off', 'NO'])('treats PROBE=%s as not set', (PROBE) => {
    expect(buildLaunchParams({ PROBE })).toEqual({});
  });

  it('rejects an unknown transport', () => {
    expect(() => buildLaunchParams({ TRANSPORT: 'pigeon' })).toThrow(/TRANSPORT/);
  });
});
