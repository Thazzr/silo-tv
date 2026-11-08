// Luna service bridge without webOSTV.js. Works with both bridge constructors webOS has shipped.

export interface LunaOptions {
  timeoutMs?: number;
}

export class LunaError extends Error {
  errorCode: unknown;
  errorText: string | undefined;
  constructor(message: string, errorCode?: unknown, errorText?: string) {
    super(message);
    this.name = 'LunaError';
    this.errorCode = errorCode;
    this.errorText = errorText;
  }
}

const DEFAULT_TIMEOUT_MS = 5000;

// Bridges can be garbage-collected before their callback fires, so each one is held here
// until it has answered or timed out.
const pendingBridges = new Set<WebOSServiceBridgeInstance>();

/** Test hook: number of bridge instances currently held. */
export function pendingBridgeCount(): number {
  return pendingBridges.size;
}

function bridgeConstructor(): WebOSServiceBridgeConstructor | undefined {
  return window.WebOSServiceBridge ?? window.PalmServiceBridge;
}

export function isWebOS(): boolean {
  return bridgeConstructor() !== undefined;
}

export function lunaCall<T>(
  uri: string,
  params: object = {},
  options: LunaOptions = {},
): Promise<T> {
  const Bridge = bridgeConstructor();
  if (!Bridge) return Promise.reject(new LunaError('No Luna service bridge available'));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<T>((resolve, reject) => {
    const bridge = new Bridge();
    pendingBridges.add(bridge);

    const finish = () => {
      clearTimeout(timer);
      bridge.onservicecallback = null;
      pendingBridges.delete(bridge);
    };
    const timer = setTimeout(() => {
      finish();
      reject(new LunaError(`Luna call to ${uri} timed out after ${timeoutMs} ms`));
    }, timeoutMs);

    bridge.onservicecallback = (raw) => {
      finish();
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        reject(new LunaError(`Luna call to ${uri} returned a non-JSON response`));
        return;
      }
      const response = parsed as Record<string, unknown> | null;
      if (response && typeof response === 'object' && response.returnValue === false) {
        const errorText = typeof response.errorText === 'string' ? response.errorText : undefined;
        reject(
          new LunaError(errorText ?? `Luna call to ${uri} failed`, response.errorCode, errorText),
        );
        return;
      }
      resolve(parsed as T);
    };

    try {
      bridge.call(uri, JSON.stringify(params));
    } catch (error) {
      finish();
      reject(error instanceof Error ? error : new LunaError(String(error)));
    }
  });
}
