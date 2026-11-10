// The stop sequence on a stub client under fake timers: the wait after the unload, one body for
// every try, the final sample, and which answers are retried.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SiloClient } from '../../api/client';
import { stopTiming } from '../stopTiming';
import { STOP_AFTER_UNLOAD_MS, STOP_RETRY_DELAYS_MS, StopSequence } from './StopSequence';

interface Sent {
  sessionId: string;
  body: { installation_id: string; stop_id: string; sequence?: number; position?: number };
}

/** Each entry answers one DELETE: a status, or 'network' for a request that never arrived. */
function setup(answers: (number | 'network')[], reading?: { position: number; paused: boolean }) {
  const sent: Sent[] = [];
  const queue = [...answers];
  const del = vi.fn(
    async (
      _path: string,
      init: { params: { path: { session_id: string } }; body: Sent['body'] },
    ) => {
      sent.push({ sessionId: init.params.path.session_id, body: init.body });
      const next = queue.shift() ?? 200;
      if (next === 'network') throw new TypeError('network');
      return { response: new Response(null, { status: next }) };
    },
  );
  const nextSequence = vi.fn(() => 42);
  const stop = new StopSequence({
    client: { DELETE: del } as unknown as SiloClient,
    header: () => ({ 'X-Profile-Id': 'p1' }),
    installationId: () => 'install-1',
    nextSequence,
  });
  let done = false;
  const finished = stop.send('session-1', reading).then(() => {
    done = true;
  });
  return { sent, del, nextSequence, finished, isDone: () => done };
}

beforeEach(() => {
  vi.useFakeTimers();
  stopTiming.delayMs = 0;
});
afterEach(() => {
  vi.useRealTimers();
  stopTiming.delayMs = undefined;
  stopTiming.waiting = 0;
});

describe('StopSequence timing', () => {
  it('waits STOP_AFTER_UNLOAD_MS before the first DELETE when the seam is not overridden', async () => {
    stopTiming.delayMs = undefined;
    const { sent, finished } = setup([204]);
    await vi.advanceTimersByTimeAsync(STOP_AFTER_UNLOAD_MS - 1);
    expect(sent).toHaveLength(0);
    expect(stopTiming.waiting).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await finished;
    expect(sent).toHaveLength(1);
    expect(stopTiming.waiting).toBe(0);
  });

  it('honours the test seam delay, which may be 0', async () => {
    stopTiming.delayMs = 300;
    const { sent, finished } = setup([204]);
    await vi.advanceTimersByTimeAsync(299);
    expect(sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await finished;
    expect(sent).toHaveLength(1);
  });

  it('sends the stop for the session it was given', async () => {
    const { sent, finished } = setup([204]);
    await vi.runAllTimersAsync();
    await finished;
    expect(sent[0]!.sessionId).toBe('session-1');
    expect(sent[0]!.body.installation_id).toBe('install-1');
  });
});

describe('StopSequence body', () => {
  it('sends the final sample with a sequence and the position when there is a reading', async () => {
    const { sent, nextSequence, finished } = setup([204], { position: 77.5, paused: true });
    await vi.runAllTimersAsync();
    await finished;
    expect(sent[0]!.body).toMatchObject({ sequence: 42, position: 77.5, is_paused: true });
    expect(nextSequence).toHaveBeenCalledTimes(1);
  });

  it('sends neither sequence nor position without a reading, and does not use up a sequence number', async () => {
    const { sent, nextSequence, finished } = setup([204], undefined);
    await vi.runAllTimersAsync();
    await finished;
    expect(sent[0]!.body).not.toHaveProperty('sequence');
    expect(sent[0]!.body).not.toHaveProperty('position');
    expect(sent[0]!.body).not.toHaveProperty('is_paused');
    expect(sent[0]!.body.stop_id).toBeTruthy();
    expect(nextSequence).not.toHaveBeenCalled();
  });

  it('treats a null reading like no reading', async () => {
    const sent: Sent[] = [];
    const stop = new StopSequence({
      client: {
        DELETE: async (_p: string, init: { body: Sent['body'] }) => {
          sent.push({ sessionId: '', body: init.body });
          return { response: new Response(null, { status: 204 }) };
        },
      } as unknown as SiloClient,
      header: () => ({ 'X-Profile-Id': 'p1' }),
      installationId: () => 'install-1',
      nextSequence: () => 9,
    });
    const finished = stop.send('s', null);
    await vi.runAllTimersAsync();
    await finished;
    expect(sent[0]!.body).not.toHaveProperty('sequence');
  });

  it('reuses one body, stop_id and sequence included, for every try, and takes the sequence once', async () => {
    const { sent, nextSequence, finished } = setup([503, 'network', 204], {
      position: 5,
      paused: false,
    });
    await vi.runAllTimersAsync();
    await finished;
    expect(sent).toHaveLength(3);
    expect(sent[1]!.body).toEqual(sent[0]!.body);
    expect(sent[2]!.body).toEqual(sent[0]!.body);
    expect(nextSequence).toHaveBeenCalledTimes(1);
  });

  it('uses a new stop_id for a new stop', async () => {
    const first = setup([204]);
    const second = setup([204]);
    await vi.runAllTimersAsync();
    await Promise.all([first.finished, second.finished]);
    expect(first.sent[0]!.body.stop_id).not.toBe(second.sent[0]!.body.stop_id);
  });
});

describe('StopSequence retries', () => {
  it.each([500, 502, 503, 408, 429])('retries on %i', async (status) => {
    const { sent, finished } = setup([status, 204]);
    await vi.runAllTimersAsync();
    await finished;
    expect(sent).toHaveLength(2);
  });

  it('retries when no answer came at all', async () => {
    const { sent, finished } = setup(['network', 204]);
    await vi.runAllTimersAsync();
    await finished;
    expect(sent).toHaveLength(2);
  });

  it.each([200, 204, 404, 400, 401, 403, 409, 410, 422])('does not retry on %i', async (status) => {
    const { sent, finished } = setup([status, 204]);
    await vi.runAllTimersAsync();
    await finished;
    expect(sent).toHaveLength(1);
  });

  it('waits the listed delays between the tries', async () => {
    const { sent, finished } = setup([503, 503, 204]);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(STOP_RETRY_DELAYS_MS[0]! - 1);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(STOP_RETRY_DELAYS_MS[1]! - 1);
    expect(sent).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    await finished;
    expect(sent).toHaveLength(3);
  });

  it('ends after the last retry, without a further try, and resolves', async () => {
    const { sent, finished, isDone } = setup([503, 503, 503, 503, 503]);
    await vi.runAllTimersAsync();
    await finished;
    expect(isDone()).toBe(true);
    // the first try and one per listed delay
    expect(sent).toHaveLength(1 + STOP_RETRY_DELAYS_MS.length);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent).toHaveLength(1 + STOP_RETRY_DELAYS_MS.length);
  });

  it('ends quietly when every try finds no network', async () => {
    const { sent, finished } = setup(['network', 'network', 'network', 'network']);
    await vi.runAllTimersAsync();
    await expect(finished).resolves.toBeUndefined();
    expect(sent).toHaveLength(1 + STOP_RETRY_DELAYS_MS.length);
  });
});

describe('StopSequence contract pins', () => {
  it('waits 2000 ms after the unload in production (webOS 26 stop order)', () => {
    expect(STOP_AFTER_UNLOAD_MS).toBe(2000);
  });

  it('retries at 500 ms and 1500 ms, and stops after exactly three DELETE calls', async () => {
    expect(STOP_RETRY_DELAYS_MS).toEqual([500, 1500]);
    const { sent, del, finished } = setup([503, 503, 503, 503, 503]);
    await vi.runAllTimersAsync();
    await expect(finished).resolves.toBeUndefined();
    expect(del).toHaveBeenCalledTimes(3);
    expect(sent).toHaveLength(3);
  });

  it('sends the profile header from deps', async () => {
    const del = vi.fn<(path: string, init: unknown) => Promise<{ response: Response }>>(
      async () => ({
        response: new Response(null, { status: 204 }),
      }),
    );
    const header = { 'X-Profile-Id': 'profile-7' };
    const stop = new StopSequence({
      client: { DELETE: del } as unknown as SiloClient,
      header: () => header,
      installationId: () => 'i',
      nextSequence: () => 1,
    });
    const finished = stop.send('s');
    await vi.runAllTimersAsync();
    await finished;
    const init = del.mock.calls[0]![1] as { params: { header: unknown } };
    expect(init.params.header).toEqual(header);
  });
});
