import { readBasicDeviceInfo } from '../shared/deviceBasics';
import { mapKey } from '../shared/keys';
import { queryParams } from '../shared/launchParams';
import { probeDecodingInfo, probeDisplay, probeMedia } from '../shared/mediaProbe';
import { localKeyValueStore } from '../shared/storage';
import type { HdrConfig, Platform } from '../types';

const NO_HDR: HdrConfig = { known: false, hdr: false, dolbyVision: false, atmos: false };

export const browserPlatform: Platform = {
  id: 'browser',
  siloPlatformId: 'web',
  isTv: false,
  manufacturer: null,
  deviceLabel: () => 'Web browser',
  readDeviceInfo: () => Promise.resolve({ platform: 'browser', ...readBasicDeviceInfo() }),
  readHdrConfig: () => Promise.resolve({ ...NO_HDR }),
  readPlatformVersion: () => null,
  readLaunchParams: queryParams,
  // A browser tab is never launched again with new parameters.
  onRelaunch: () => () => undefined,
  mapKey,
  // The browser has no app to close.
  exitApp: () => undefined,
  storage: localKeyValueStore,
  probeMedia,
  probeDisplay,
  probeDecodingInfo,
};
