import { readHdrConfig, readPlatformVersion } from '../platform/device';
import { isWebOS } from '../platform/luna';
import { probeDisplay, probeMedia } from '../platform/mediaProbe';
import type { ProfileProbe } from './deviceProfile';

/** Runs the capability probes the device profile is built from. */
export async function collectProfileProbe(): Promise<ProfileProbe> {
  const webos = isWebOS();
  const hdr = await readHdrConfig();
  return {
    media: probeMedia(),
    display: probeDisplay(),
    hdr,
    platform: webos ? 'webos' : 'browser',
    appVersion: __APP_VERSION__,
    osVersion: webos ? readPlatformVersion() : null,
  };
}
