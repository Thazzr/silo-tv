import type { DeviceInfo } from '../types';

export function chromeMajorFromUserAgent(ua: string): number | null {
  const match = /Chrome\/(\d+)/.exec(ua);
  return match?.[1] ? Number(match[1]) : null;
}

/** What every platform can tell from web standards alone. */
export function readBasicDeviceInfo(): Omit<DeviceInfo, 'platform'> {
  return {
    userAgent: navigator.userAgent,
    screen: {
      width: screen.width,
      height: screen.height,
      colorDepth: screen.colorDepth,
    },
    devicePixelRatio: window.devicePixelRatio,
  };
}
