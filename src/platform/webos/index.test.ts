import { afterEach, describe, expect, it, vi } from 'vitest';
import { fake, installFakeBridge } from '../../test/fakeBridge';
import { webosPlatform } from '.';
import { SERVICE_ID } from './serviceFetch';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete window.webOSSystem;
  delete window.PalmSystem;
  window.history.replaceState(null, '', '/');
});

describe('webosPlatform', () => {
  it('delegates the device reads to Luna', async () => {
    installFakeBridge();
    fake.responders.set('luna://com.webos.service.tv.systemproperty/getSystemInfo', () =>
      JSON.stringify({ returnValue: true, modelName: 'OLED65C1' }),
    );
    fake.responders.set('luna://com.webos.service.config/getConfigs', () =>
      JSON.stringify({ returnValue: true, configs: { 'tv.model.supportHDR': true } }),
    );
    const info = await webosPlatform.readDeviceInfo();
    expect(info.platform).toBe('webos');
    expect(info.systemInfo).toMatchObject({ modelName: 'OLED65C1' });
    expect(await webosPlatform.readHdrConfig()).toMatchObject({ known: true, hdr: true });
    expect(fake.calls.map((c) => c.uri)).toContain('luna://com.webos.service.config/getConfigs');
  });

  it('sends proxyFetch and proxyPing to the JS service through Luna', async () => {
    installFakeBridge();
    fake.responders.set(`luna://${SERVICE_ID}/fetch`, () =>
      JSON.stringify({ returnValue: true, status: 200, statusText: 'OK', headers: {}, body: '' }),
    );
    fake.responders.set(`luna://${SERVICE_ID}/ping`, () =>
      JSON.stringify({ returnValue: true, node: 'v16', sender: 'app' }),
    );
    const response = await webosPlatform.proxyFetch?.({
      url: 'https://silo.example.test/api/v2/x',
    });
    expect(response?.status).toBe(200);
    expect((await webosPlatform.proxyPing?.())?.node).toBe('v16');
    expect(fake.calls.map((c) => c.uri)).toEqual([
      `luna://${SERVICE_ID}/fetch`,
      `luna://${SERVICE_ID}/ping`,
    ]);
  });

  it('reads the launch parameters from webOS and the query string', () => {
    window.webOSSystem = { launchParams: '{"server":"https://one.example.test","keep":true}' };
    window.history.replaceState(null, '', '/?server=https://two.example.test');
    expect(webosPlatform.readLaunchParams()).toEqual({
      server: 'https://two.example.test',
      keep: true,
    });
  });

  it('names itself for Silo as an LG webOS TV, with the model when known', () => {
    expect(webosPlatform.siloPlatformId).toBe('webos');
    expect(webosPlatform.isTv).toBe(true);
    expect(webosPlatform.manufacturer).toBe('LG');
    expect(webosPlatform.deviceLabel()).toBe('LG webOS TV');
    expect(webosPlatform.deviceLabel('  ')).toBe('LG webOS TV');
    expect(webosPlatform.deviceLabel('OLED55C1')).toBe('LG webOS TV OLED55C1');
  });

  it('exitApp closes the window', () => {
    const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    webosPlatform.exitApp();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('maps the webOS Back key (461)', () => {
    expect(webosPlatform.mapKey(new KeyboardEvent('keydown', { keyCode: 461 }))).toBe('back');
  });
});

describe('webosPlatform.onRelaunch', () => {
  it('passes the parameters of the relaunch event to the handler', () => {
    const handler = vi.fn();
    const off = webosPlatform.onRelaunch(handler);
    document.dispatchEvent(
      new CustomEvent('webOSRelaunch', { detail: { server: 'https://silo.example.test' } }),
    );
    expect(handler).toHaveBeenCalledWith({ server: 'https://silo.example.test' });
    off();
  });

  it('falls back to the refreshed system launch parameters when the event has no detail', () => {
    const handler = vi.fn();
    const off = webosPlatform.onRelaunch(handler);
    window.webOSSystem = { launchParams: '{"probe":"1"}' };
    document.dispatchEvent(new Event('webOSRelaunch'));
    expect(handler).toHaveBeenCalledWith({ probe: '1' });
    off();
  });

  it('gives an empty object for unusable parameters', () => {
    const handler = vi.fn();
    const off = webosPlatform.onRelaunch(handler);
    window.webOSSystem = { launchParams: 'garbage{' };
    document.dispatchEvent(new Event('webOSRelaunch'));
    expect(handler).toHaveBeenCalledWith({});
    off();
  });

  it('stops calling the handler after unsubscribing', () => {
    const handler = vi.fn();
    const off = webosPlatform.onRelaunch(handler);
    off();
    document.dispatchEvent(new CustomEvent('webOSRelaunch', { detail: { a: 1 } }));
    expect(handler).not.toHaveBeenCalled();
  });
});
