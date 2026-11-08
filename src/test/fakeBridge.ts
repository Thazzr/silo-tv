// Test helper: a fake Luna bridge installed on window. Responses are scripted per URI.
import { vi } from 'vitest';

export type Responder = (params: unknown) => string | null;

export const fake = {
  responders: new Map<string, Responder>(),
  calls: [] as { uri: string; params: unknown }[],
  instances: [] as FakeBridge[],
};

export class FakeBridge {
  onservicecallback: ((response: string) => void) | null = null;
  constructor() {
    fake.instances.push(this);
  }
  call(uri: string, params: string) {
    const parsed: unknown = JSON.parse(params);
    fake.calls.push({ uri, params: parsed });
    const responder = fake.responders.get(uri);
    // A responder returning null never answers, so timeouts and held bridges can be observed.
    const answer = responder
      ? responder(parsed)
      : JSON.stringify({ returnValue: false, errorText: 'no responder' });
    if (answer !== null) queueMicrotask(() => this.onservicecallback?.(answer));
  }
}

/** The Luna URI of a service method, as the app calls it. */
export function lunaUri(service: string, method: string): string {
  return `luna://${service}/${method}`;
}

export function installFakeBridge(
  name: 'WebOSServiceBridge' | 'PalmServiceBridge' = 'WebOSServiceBridge',
) {
  fake.responders.clear();
  fake.calls.length = 0;
  fake.instances.length = 0;
  vi.stubGlobal(name, FakeBridge);
}
