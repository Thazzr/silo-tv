import { beforeEach, describe, expect, it } from 'vitest';
import { DEVICE_ID_PATTERN, deviceName, getDeviceId, getDeviceIdentity } from './deviceIdentity';

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

describe('deviceName', () => {
  it('adds the model name when known', () => {
    expect(deviceName()).toBe('LG webOS TV');
    expect(deviceName('  ')).toBe('LG webOS TV');
    expect(deviceName('OLED55C1')).toBe('LG webOS TV OLED55C1');
    expect(getDeviceIdentity('OLED55C1').name).toBe('LG webOS TV OLED55C1');
  });
});
