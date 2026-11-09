import { readBasicDeviceInfo } from '../shared/deviceBasics';
import { mapKey } from '../shared/keys';
import { queryParams } from '../shared/launchParams';
import { probeDecodingInfo, probeDisplay, probeMedia } from '../shared/mediaProbe';
import { localKeyValueStore } from '../shared/storage';
import { isValidYouTubeVideoId } from '../shared/youtube';
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
  // Dev convenience only: a browser tab has no TV app to hand over to.
  openYouTubeVideo: (videoId) => {
    if (!isValidYouTubeVideoId(videoId)) return Promise.resolve('unavailable');
    window.open(`https://www.youtube.com/watch?v=${videoId}`, '_blank', 'noopener');
    return Promise.resolve('opened');
  },
  storage: localKeyValueStore,
  probeMedia,
  probeDisplay,
  probeDecodingInfo,
};
