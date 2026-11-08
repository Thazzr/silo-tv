import { chromeMajorFromUserAgent, readBasicDeviceInfo } from '../shared/deviceBasics';
import type { DeviceInfo, HdrConfig, Part } from '../types';
import { lunaCall } from './luna';

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
  const base = readBasicDeviceInfo();
  const deviceInfo = parseDeviceInfo();
  const reported = deviceInfo?.platformVersion;
  const chromeMajor = chromeMajorFromUserAgent(base.userAgent);
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

export const HDR_CONFIG_KEYS = [
  'tv.model.supportHDR',
  'tv.model.supportDolbyVisionHDR',
  'tv.config.supportDolbyTVATMOS',
] as const;

function flag(value: unknown): boolean {
  return value === true || value === 'true' || value === 1;
}

/**
 * Reads the three HDR and Atmos flags the device profile needs. Only these named keys are
 * queried: the wildcard dump of getConfigs also contains the TV's serial number. Any failure
 * (call refused, timeout) yields all false.
 */
export async function readHdrConfig(): Promise<HdrConfig> {
  const none: HdrConfig = { known: false, hdr: false, dolbyVision: false, atmos: false };
  try {
    const answer = await lunaCall<{ configs?: Record<string, unknown> }>(
      'luna://com.webos.service.config/getConfigs',
      { configNames: [...HDR_CONFIG_KEYS] },
    );
    const configs = answer.configs;
    if (!configs || typeof configs !== 'object') return none;
    return {
      known: true,
      hdr: flag(configs['tv.model.supportHDR']),
      dolbyVision: flag(configs['tv.model.supportDolbyVisionHDR']),
      atmos: flag(configs['tv.config.supportDolbyTVATMOS']),
    };
  } catch {
    return none;
  }
}

/** The webOS platform version from the launch-time device info, when present. */
export function readPlatformVersion(): string | null {
  const reported = parseDeviceInfo()?.platformVersion;
  return typeof reported === 'string' ? reported : null;
}
