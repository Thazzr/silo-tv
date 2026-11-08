import { isWebOS, lunaCall } from './luna';

export interface ScreenInfo {
  width: number;
  height: number;
  colorDepth: number;
}

export type Part<T> = T | { error: string };

export interface DeviceInfo {
  platform: 'browser' | 'webos';
  userAgent: string;
  screen: ScreenInfo;
  devicePixelRatio: number;
  /** Chromium major version from the user agent, when present. */
  chromeMajor?: number | null;
  /** Parsed window.webOSSystem.deviceInfo; absent when missing or unparsable. */
  deviceInfo?: Record<string, unknown> | null;
  platformVersion?: string | null;
  systemInfo?: Part<Record<string, unknown>>;
  /** Raw getConfigs response; the key names are not known in advance. */
  configs?: Part<Record<string, unknown>>;
}

export function chromeMajorFromUserAgent(ua: string): number | null {
  const match = /Chrome\/(\d+)/.exec(ua);
  return match?.[1] ? Number(match[1]) : null;
}

function parseDeviceInfo(): Record<string, unknown> | null {
  const raw = window.webOSSystem?.deviceInfo ?? window.PalmSystem?.deviceInfo;
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function part(
  call: Promise<Record<string, unknown>>,
): Promise<Part<Record<string, unknown>>> {
  try {
    return await call;
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function readDeviceInfo(): Promise<DeviceInfo> {
  const userAgent = navigator.userAgent;
  const base = {
    userAgent,
    screen: {
      width: screen.width,
      height: screen.height,
      colorDepth: screen.colorDepth,
    },
    devicePixelRatio: window.devicePixelRatio,
  };
  if (!isWebOS()) return { platform: 'browser', ...base };

  const deviceInfo = parseDeviceInfo();
  const reported = deviceInfo?.platformVersion;
  const chromeMajor = chromeMajorFromUserAgent(userAgent);
  const [systemInfo, configs] = await Promise.all([
    part(
      lunaCall('luna://com.webos.service.tv.systemproperty/getSystemInfo', {
        keys: ['modelName', 'firmwareVersion', 'UHD', 'sdkVersion'],
      }),
    ),
    part(
      lunaCall('luna://com.webos.service.config/getConfigs', {
        configNames: ['tv.model.*', 'tv.config.*', 'tv.hw.*', 'tv.conti.*'],
      }),
    ),
  ]);
  return {
    platform: 'webos',
    ...base,
    chromeMajor,
    deviceInfo,
    platformVersion:
      typeof reported === 'string' ? reported : chromeMajor === null ? null : String(chromeMajor),
    systemInfo,
    configs,
  };
}
