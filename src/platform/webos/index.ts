import { mapKey } from '../shared/keys';
import { probeDecodingInfo, probeDisplay, probeMedia } from '../shared/mediaProbe';
import { localKeyValueStore } from '../shared/storage';
import type { Platform } from '../types';
import { readDeviceInfo, readHdrConfig, readPlatformVersion } from './device';
import { onRelaunch, readLaunchParams } from './launchParams';
import { openYouTubeVideo } from './youtube';
import { serviceFetch, servicePing } from './serviceFetch';

export const webosPlatform: Platform = {
  id: 'webos',
  siloPlatformId: 'webos',
  isTv: true,
  manufacturer: 'LG',
  deviceLabel: (modelName) => {
    const model = modelName?.trim();
    return model ? `LG webOS TV ${model}` : 'LG webOS TV';
  },
  readDeviceInfo,
  readHdrConfig,
  readPlatformVersion,
  readLaunchParams,
  onRelaunch,
  mapKey,
  // LG's Back-button guide: after the app's own exit popup, the app closes itself.
  exitApp: () => window.close(),
  openYouTubeVideo,
  storage: localKeyValueStore,
  proxyFetch: serviceFetch,
  proxyPing: servicePing,
  probeMedia,
  probeDisplay,
  probeDecodingInfo,
};
