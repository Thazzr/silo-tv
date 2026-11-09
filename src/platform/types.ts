import type { RemoteKey } from './shared/keys';
import type { OpenYouTubeResult } from './shared/youtube';
import type { DecodingResult, DisplayInfo, ProbeEnv, ProbeRow } from './shared/mediaProbe';

export type { RemoteKey } from './shared/keys';
export type {
  Candidate,
  DecodingResult,
  DisplayInfo,
  ProbeEnv,
  ProbeRow,
} from './shared/mediaProbe';

export interface ScreenInfo {
  width: number;
  height: number;
  colorDepth: number;
}

export type { OpenYouTubeResult } from './shared/youtube';

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

/** The TV's own HDR and audio flags, from named config keys only. */
export interface HdrConfig {
  /** True when the TV answered the config call; false means "unknown", not "unsupported". */
  known: boolean;
  hdr: boolean;
  dolbyVision: boolean;
  atmos: boolean;
}

export interface ProxyFetchRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface ProxyFetchResponse {
  returnValue: true;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

export interface ProxyPingResponse {
  returnValue: true;
  node: string;
  /** The sender as the service received it; shows the real caller-id format on the device. */
  sender: string;
}

/** A small key-value store. It never throws: failures read as "nothing stored". */
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/**
 * Everything that differs between TV platforms (webOS now, Samsung Tizen later) and the browser.
 * Screens, features, the API layer and the playback logic talk only to this interface.
 */
export interface Platform {
  readonly id: 'webos' | 'browser';
  /** The value Silo expects as `X-Silo-Device-Platform` and `device.platform`. */
  readonly siloPlatformId: 'webos' | 'web';
  /** True on a TV: the playback profile then reports hardware decoding and native containers. */
  readonly isTv: boolean;
  /** Device manufacturer for the playback profile, when the platform has a fixed one. */
  readonly manufacturer: string | null;
  /** Human-readable device name for `X-Silo-Device-Name`; `modelName` is added when known. */
  deviceLabel(modelName?: string | null): string;

  readDeviceInfo(): Promise<DeviceInfo>;
  readHdrConfig(): Promise<HdrConfig>;
  /** The platform's OS version for server-side diagnostics, or null when unknown. */
  readPlatformVersion(): string | null;

  /** Launch parameters of this start (platform launch parameters merged with the query string). */
  readLaunchParams(): Record<string, unknown>;
  /** Calls `handler` when the running app is launched again; returns the unsubscribe function. */
  onRelaunch(handler: (params: Record<string, unknown>) => void): () => void;

  mapKey(e: KeyboardEvent): RemoteKey | null;
  /** Closes the app. Call it only after the app's own exit confirmation. */
  exitApp(): void;

  /**
   * Hands a YouTube video (by its id) to the TV's YouTube app; nothing is fetched from Google by
   * this app. Answers 'unavailable' for an id that is not a plain video id and when the platform
   * has no YouTube app to hand over to.
   */
  openYouTubeVideo(videoId: string): Promise<OpenYouTubeResult>;

  readonly storage: KeyValueStore;

  /** Present only where a bundled service can send requests outside the web engine's CORS rules. */
  proxyFetch?: (req: ProxyFetchRequest) => Promise<ProxyFetchResponse>;
  proxyPing?: () => Promise<ProxyPingResponse>;

  /** `env` lets tests script the answers; by default the web engine is asked. */
  probeMedia(env?: ProbeEnv): ProbeRow[];
  probeDisplay(): DisplayInfo;
  probeDecodingInfo(): Promise<Record<string, DecodingResult> | null>;
}
