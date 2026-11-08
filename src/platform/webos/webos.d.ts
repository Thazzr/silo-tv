// Minimal globals injected by webOS. No webOSTV.js or Enact: we only need these few members.

interface WebOSServiceBridgeInstance {
  onservicecallback: ((response: string) => void) | null;
  call(uri: string, params: string): void;
  cancel?(): void;
}

interface WebOSServiceBridgeConstructor {
  new (): WebOSServiceBridgeInstance;
}

interface WebOSSystemInfo {
  /** JSON string. */
  deviceInfo?: string;
  /** JSON string. */
  launchParams?: string;
}

interface Window {
  WebOSServiceBridge?: WebOSServiceBridgeConstructor;
  PalmServiceBridge?: WebOSServiceBridgeConstructor;
  webOSSystem?: WebOSSystemInfo;
  PalmSystem?: WebOSSystemInfo;
}
