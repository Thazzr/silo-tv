import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeBridge } from '../test/fakeBridge';
import { setPlatformForTests } from '../platform';
import { DEVICE_ID_PATTERN, getDeviceId, getDeviceIdentity } from './deviceIdentity';

beforeEach(() => localStorage.clear());

describe('getDeviceId', () => {
  it('generates 32 hex characters that Silo accepts', () => {
    const id = getDeviceId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(id).toMatch(DEVICE_ID_PATTERN);
  });

  it('generates once and reuses the stored id', () => {
    const first = getDeviceId();
    expect(getDeviceId()).toBe(first);
    expect(Object.values({ ...localStorage })).toContain(first);
  });

  it('replaces a stored id with characters Silo would drop', () => {
    localStorage.setItem('silo-tv.deviceId', 'not valid!');
    expect(getDeviceId()).toMatch(/^[0-9a-f]{32}$/);
  });

  it('differs between installations', () => {
    const first = getDeviceId();
    localStorage.clear();
    expect(getDeviceId()).not.toBe(first);
  });
});

describe('getDeviceIdentity', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setPlatformForTests(null);
  });

  it('takes the name from the platform: a browser label, or LG webOS TV plus the model', () => {
    expect(getDeviceIdentity('OLED55C1').name).toBe('Web browser');
    installFakeBridge();
    setPlatformForTests(null);
    expect(getDeviceIdentity().name).toBe('LG webOS TV');
    expect(getDeviceIdentity('  ').name).toBe('LG webOS TV');
    expect(getDeviceIdentity('OLED55C1').name).toBe('LG webOS TV OLED55C1');
  });
});
