import { afterEach, describe, expect, it, vi } from 'vitest';
import { chromeMajorFromUserAgent } from '../shared/deviceBasics';
import { readDeviceInfo, readHdrConfig, readPlatformVersion } from './device';
import { fake, installFakeBridge } from '../../test/fakeBridge';

const SYSTEM_INFO = 'luna://com.webos.service.tv.systemproperty/getSystemInfo';
const CONFIGS = 'luna://com.webos.service.config/getConfigs';
const WEBOS_UA =
  'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Safari/537.36 WebAppManager';

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.webOSSystem;
  delete window.PalmSystem;
});

describe('chromeMajorFromUserAgent', () => {
  it('reads Chrome/79 from a webOS 6 user agent', () => {
    expect(chromeMajorFromUserAgent(WEBOS_UA)).toBe(79);
  });

  it('reads a desktop user agent', () => {
    expect(
      chromeMajorFromUserAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/131.0.0.0 Safari/537.36'),
    ).toBe(131);
  });

  it('returns null without Chrome', () => {
    expect(chromeMajorFromUserAgent('Mozilla/5.0 Firefox/120.0')).toBeNull();
  });
});

describe('readDeviceInfo', () => {
  it('collects deviceInfo and both Luna calls on webOS', async () => {
    installFakeBridge();
    vi.stubGlobal('navigator', { userAgent: WEBOS_UA });
    window.webOSSystem = { deviceInfo: '{"modelName":"OLED","platformVersion":"6.0.0"}' };
    fake.responders.set(SYSTEM_INFO, () =>
      JSON.stringify({ returnValue: true, modelName: 'OLED65C1', UHD: 'true' }),
    );
    fake.responders.set(CONFIGS, () =>
      JSON.stringify({ returnValue: true, configs: { 'tv.model.edidType': 'x' } }),
    );
    const info = await readDeviceInfo();
    expect(info.platform).toBe('webos');
    expect(info.chromeMajor).toBe(79);
    expect(info.platformVersion).toBe('6.0.0');
    expect(info.deviceInfo).toEqual({ modelName: 'OLED', platformVersion: '6.0.0' });
    expect(info.systemInfo).toMatchObject({ modelName: 'OLED65C1' });
    expect(info.configs).toEqual({ returnValue: true, configs: { 'tv.model.edidType': 'x' } });
    expect(fake.calls).toEqual([
      {
        uri: SYSTEM_INFO,
        params: { keys: ['modelName', 'firmwareVersion', 'UHD', 'sdkVersion'] },
      },
      {
        uri: CONFIGS,
        params: { configNames: ['tv.model.*', 'tv.config.*', 'tv.hw.*', 'tv.conti.*'] },
      },
    ]);
  });

  it('keeps the other part when one Luna call fails', async () => {
    installFakeBridge();
    vi.stubGlobal('navigator', { userAgent: WEBOS_UA });
    fake.responders.set(SYSTEM_INFO, () =>
      JSON.stringify({ returnValue: false, errorText: 'service unavailable' }),
    );
    fake.responders.set(CONFIGS, () => JSON.stringify({ returnValue: true, configs: {} }));
    const info = await readDeviceInfo();
    expect(info.systemInfo).toEqual({ error: 'service unavailable' });
    expect(info.configs).toEqual({ returnValue: true, configs: {} });
  });

  it('tolerates a garbage deviceInfo string and falls back to the user agent version', async () => {
    installFakeBridge();
    vi.stubGlobal('navigator', { userAgent: WEBOS_UA });
    window.webOSSystem = { deviceInfo: 'garbage{' };
    fake.responders.set(SYSTEM_INFO, () => JSON.stringify({ returnValue: true }));
    fake.responders.set(CONFIGS, () => JSON.stringify({ returnValue: true }));
    const info = await readDeviceInfo();
    expect(info.deviceInfo).toBeNull();
    expect(info.platformVersion).toBe('79');
  });
});

describe('readPlatformVersion', () => {
  it('reads the launch-time platform version', () => {
    window.webOSSystem = { deviceInfo: '{"platformVersion":"24.0.0"}' };
    expect(readPlatformVersion()).toBe('24.0.0');
  });

  it('is null without a reported version', () => {
    expect(readPlatformVersion()).toBeNull();
  });
});

describe('readHdrConfig', () => {
  const NONE = { known: false, hdr: false, dolbyVision: false, atmos: false };

  it('queries exactly the three named keys and never a wildcard', async () => {
    installFakeBridge();
    fake.responders.set(CONFIGS, () =>
      JSON.stringify({
        returnValue: true,
        configs: {
          'tv.model.supportHDR': true,
          'tv.model.supportDolbyVisionHDR': false,
          'tv.config.supportDolbyTVATMOS': true,
        },
      }),
    );
    const config = await readHdrConfig();
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.uri).toBe(CONFIGS);
    expect(fake.calls[0]?.params).toEqual({
      configNames: [
        'tv.model.supportHDR',
        'tv.model.supportDolbyVisionHDR',
        'tv.config.supportDolbyTVATMOS',
      ],
    });
    expect(JSON.stringify(fake.calls[0]?.params)).not.toContain('*');
    expect(config).toEqual({ known: true, hdr: true, dolbyVision: false, atmos: true });
  });

  it('takes the string "true" as true and a missing key as false', async () => {
    installFakeBridge();
    fake.responders.set(CONFIGS, () =>
      JSON.stringify({ returnValue: true, configs: { 'tv.model.supportHDR': 'true' } }),
    );
    expect(await readHdrConfig()).toEqual({
      known: true,
      hdr: true,
      dolbyVision: false,
      atmos: false,
    });
  });

  it('yields all false when the call fails', async () => {
    installFakeBridge();
    fake.responders.set(CONFIGS, () => JSON.stringify({ returnValue: false, errorText: 'denied' }));
    expect(await readHdrConfig()).toEqual(NONE);
  });

  it('yields all false without a Luna bridge', async () => {
    expect(await readHdrConfig()).toEqual(NONE);
  });
});
