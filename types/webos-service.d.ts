// Minimal typings for the webOS-provided "webos-service" module (not on npm).
declare module 'webos-service' {
  interface ServiceMessage {
    payload: Record<string, unknown> | undefined;
    respond(response: Record<string, unknown>): void;
  }

  class Service {
    constructor(id: string);
    register(name: string, handler: (message: ServiceMessage) => void): void;
  }

  export = Service;
}
