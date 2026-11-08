/** A fetch-compatible function; the client never calls the global fetch itself. */
export type Transport = (request: Request) => Promise<Response>;

export type TransportMode = 'direct' | 'service';
