import Hls from 'hls.js';
import { getPlatform } from '../platform';
import type { ProfileProbe } from './deviceProfile';

/** Runs the capability probes the device profile is built from. */
export async function collectProfileProbe(): Promise<ProfileProbe> {
  const platform = getPlatform();
  const hdr = await platform.readHdrConfig();
  return {
    media: platform.probeMedia(),
    display: platform.probeDisplay(),
    hdr,
    siloPlatform: platform.siloPlatformId,
    isTv: platform.isTv,
    manufacturer: platform.manufacturer,
    appVersion: __APP_VERSION__,
    osVersion: platform.readPlatformVersion(),
    hlsJs: Hls.isSupported(),
  };
}
