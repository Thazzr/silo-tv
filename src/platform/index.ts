// The only entry point into the platform layer: callers import from here, never from
// ./webos or ./browser (an ESLint rule enforces it).
import { browserPlatform } from './browser';
import type { Platform } from './types';
import { webosPlatform } from './webos';
import { isWebOS } from './webos/luna';

export type {
  DecodingResult,
  DeviceInfo,
  DisplayInfo,
  HdrConfig,
  KeyValueStore,
  Candidate,
  OpenYouTubeResult,
  Part,
  ProbeEnv,
  Platform,
  ProbeRow,
  ProxyFetchRequest,
  ProxyFetchResponse,
  ProxyPingResponse,
  RemoteKey,
  ScreenInfo,
} from './types';
export { chromeMajorFromUserAgent } from './shared/deviceBasics';
export { isValidYouTubeVideoId } from './shared/youtube';
export { CANDIDATES } from './shared/mediaProbe';

let current: Platform | null = null;

/** The platform this page runs on: webOS when a Luna bridge exists, else the browser. */
export function getPlatform(): Platform {
  current ??= isWebOS() ? webosPlatform : browserPlatform;
  return current;
}

/** Test hook: pins a platform; `null` makes the next `getPlatform()` detect again. */
export function setPlatformForTests(platform: Platform | null): void {
  current = platform;
}
