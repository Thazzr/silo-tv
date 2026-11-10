// Ending the session on the server: one stop request with the final sample, delayed until the
// video is unloaded and retried with the same body when no answer came.
import type { SiloClient } from '../../api/client';
import { stopTiming } from '../stopTiming';
import { uuidV4 } from '../uuid';
import type { PlayerReading, ProfileHeader } from './types';

/** Waits before the retries of a stop that did not arrive (the stop_id stays the same). */
export const STOP_RETRY_DELAYS_MS = [500, 1_500];
/**
 * The stop goes out this long after the video was unloaded. webOS 26 hangs the next stream
 * request when the server aborts a stream the media stack still reads, and a stop that arrives
 * while the element is still loaded does exactly that. If the app closes within this time the
 * stop never goes out; the server's session lease ends the session then.
 */
export const STOP_AFTER_UNLOAD_MS = 2_000;

export interface StopDeps {
  client: SiloClient;
  header(): ProfileHeader;
  installationId(): string;
  /** The next report sequence number: the final sample continues the heartbeat's count. */
  nextSequence(): number;
}

export class StopSequence {
  constructor(private readonly deps: StopDeps) {}

  /**
   * The caller has unloaded the video and taken the final reading already (`reading`, when the
   * session had a position to report).
   */
  async send(sessionId: string, reading?: PlayerReading | null): Promise<void> {
    // One body for every try: a retry is the same stop (same stop_id, same final sample).
    const body = {
      installation_id: this.deps.installationId(),
      stop_id: uuidV4(),
      // The final sample: sequence and position go together or not at all.
      ...(reading
        ? {
            sequence: this.deps.nextSequence(),
            position: reading.position,
            is_paused: reading.paused,
          }
        : {}),
    };
    await new Promise<void>((resolve) => {
      stopTiming.waiting += 1;
      setTimeout(() => {
        stopTiming.waiting -= 1;
        resolve();
      }, stopTiming.delayMs ?? STOP_AFTER_UNLOAD_MS);
    });
    for (let attempt = 0; ; attempt += 1) {
      try {
        const { response } = await this.deps.client.DELETE('/api/v2/playback/{session_id}', {
          params: { path: { session_id: sessionId }, header: this.deps.header() },
          body,
        });
        const status = response.status;
        // 404: the session had already ended. Other 4xx: retrying cannot change the answer.
        if (status < 500 && status !== 408 && status !== 429) return;
      } catch {
        // No answer: try again below.
      }
      const delay = STOP_RETRY_DELAYS_MS[attempt];
      // Out of retries: the server ends an abandoned session on its own after a timeout.
      if (delay === undefined) return;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
