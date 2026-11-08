import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserPlatform } from '.';

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('browserPlatform', () => {
  it('names itself for Silo as a plain web client', () => {
    expect(browserPlatform.siloPlatformId).toBe('web');
    expect(browserPlatform.isTv).toBe(false);
    expect(browserPlatform.manufacturer).toBeNull();
    expect(browserPlatform.deviceLabel('OLED55C1')).toBe('Web browser');
  });

  it('has no proxy service', () => {
    expect(browserPlatform.id).toBe('browser');
    expect(browserPlatform.proxyFetch).toBeUndefined();
    expect(browserPlatform.proxyPing).toBeUndefined();
  });

  it('exitApp does nothing, in particular it does not close the window', () => {
    const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    expect(() => browserPlatform.exitApp()).not.toThrow();
    expect(close).not.toHaveBeenCalled();
    close.mockRestore();
  });

  it('onRelaunch never calls the handler and returns a harmless unsubscribe', () => {
    const handler = vi.fn();
    const off = browserPlatform.onRelaunch(handler);
    document.dispatchEvent(new CustomEvent('webOSRelaunch', { detail: { a: 1 } }));
    expect(handler).not.toHaveBeenCalled();
    expect(() => off()).not.toThrow();
  });

  it('reads launch parameters from the query string only', () => {
    window.history.replaceState(null, '', '/?probe=1&server=https%3A%2F%2Fsilo.example.test');
    expect(browserPlatform.readLaunchParams()).toEqual({
      probe: '1',
      server: 'https://silo.example.test',
    });
  });

  it('reports only the basics as device info, with no HDR knowledge', async () => {
    const info = await browserPlatform.readDeviceInfo();
    expect(info.platform).toBe('browser');
    expect(info.userAgent).toBe(navigator.userAgent);
    expect(info.screen).toEqual({
      width: screen.width,
      height: screen.height,
      colorDepth: screen.colorDepth,
    });
    expect(info.devicePixelRatio).toBe(window.devicePixelRatio);
    expect(info).not.toHaveProperty('systemInfo');
    expect(info).not.toHaveProperty('configs');
    expect(await browserPlatform.readHdrConfig()).toEqual({
      known: false,
      hdr: false,
      dolbyVision: false,
      atmos: false,
    });
    expect(browserPlatform.readPlatformVersion()).toBeNull();
  });

  it('maps Back from Escape, Backspace and 461', () => {
    for (const keyCode of [27, 8, 461]) {
      expect(browserPlatform.mapKey(new KeyboardEvent('keydown', { keyCode }))).toBe('back');
    }
  });
});
