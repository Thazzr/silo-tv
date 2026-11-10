// The progress reporter's single flight: one request on its way at most, the newest report wins,
// nothing is retried. A stub client lets each test settle the requests by hand.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SiloClient } from '../../api/client';
import { PROGRESS_INTERVAL_MS, ProgressReporter, type ProgressDeps } from './ProgressReporter';
import type { PlayerReading } from './types';

interface Sent {
  sessionId: string;
  body: { sequence: number; position: number; is_paused: boolean };
  settle(status?: number): Promise<void>;
  fail(): Promise<void>;
}

function setup() {
  const state = {
    stopped: false,
    sessionId: 'session-1',
    reading: { position: 10, paused: false } as PlayerReading | null,
    playing: true,
    hasPlayed: true,
  };
  const sent: Sent[] = [];
  const post = vi.fn(
    (_path: string, init: { params: { path: { session_id: string } }; body: Sent['body'] }) => {
      let resolve!: (value: { error: unknown; response: Response }) => void;
      let reject!: (reason: unknown) => void;
      const promise = new Promise<{ error: unknown; response: Response }>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      sent.push({
        sessionId: init.params.path.session_id,
        body: init.body,
        settle: async (status = 200) => {
          resolve({ error: undefined, response: new Response(null, { status }) });
          await promise.catch(() => undefined);
          await Promise.resolve();
          await Promise.resolve();
        },
        fail: async () => {
          reject(new TypeError('network'));
          await promise.catch(() => undefined);
          await Promise.resolve();
          await Promise.resolve();
        },
      });
      return promise;
    },
  );
  const deps: ProgressDeps = {
    client: { POST: post } as unknown as SiloClient,
    header: () => ({ 'X-Profile-Id': 'p1' }),
    installationId: () => 'install-1',
    sessionId: () => state.sessionId,
    isStopped: () => state.stopped,
    reading: () => (state.reading ? { ...state.reading } : null),
    hasPlayed: () => state.hasPlayed,
    isPlaying: () => state.playing,
    onEnded: vi.fn(),
    onExpired: vi.fn(),
  };
  const reporter = new ProgressReporter(deps);
  return { reporter, state, sent, deps };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('ProgressReporter single flight', () => {
  it('sends the first report at once', () => {
    const { reporter, sent } = setup();
    reporter.send(false);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toMatchObject({ sequence: 1, position: 10, is_paused: false });
  });

  it('does not start a second request while one is in flight, and sends one more when it settles', async () => {
    const { reporter, state, sent } = setup();
    reporter.send(false);
    state.reading = { position: 20, paused: false };
    reporter.send(false);
    state.reading = { position: 30, paused: false };
    reporter.send(false);
    expect(sent).toHaveLength(1);

    await sent[0]!.settle();
    // Exactly one more, with the reading taken now and the next sequence.
    expect(sent).toHaveLength(2);
    expect(sent[1]!.body).toMatchObject({ sequence: 2, position: 30, is_paused: false });

    await sent[1]!.settle();
    expect(sent).toHaveLength(2);
  });

  it('keeps the latest paused flag of the reports that waited', async () => {
    const { reporter, sent } = setup();
    reporter.send(false);
    reporter.send(true);
    reporter.send(false);
    reporter.send(true);
    await sent[0]!.settle();
    expect(sent).toHaveLength(2);
    expect(sent[1]!.body.is_paused).toBe(true);
  });

  it('assigns the sequence when a report is sent, so sent order and sequence order agree', async () => {
    const { reporter, sent } = setup();
    reporter.send(false);
    reporter.send(false);
    // The waiting report has no sequence yet: the stop's number is the next one.
    expect(reporter.nextSequence()).toBe(2);
    await sent[0]!.settle();
    expect(sent[1]!.body.sequence).toBe(3);
  });

  it('does not retry a failed request, and a waiting report goes out after the failure', async () => {
    const { reporter, sent } = setup();
    reporter.send(false);
    await sent[0]!.fail();
    expect(sent).toHaveLength(1);

    reporter.send(false);
    reporter.send(true);
    expect(sent).toHaveLength(2);
    await sent[1]!.fail();
    // The waiting one went out; the failed one was not repeated.
    expect(sent).toHaveLength(3);
    expect(sent[2]!.body).toMatchObject({ is_paused: true });
    await sent[2]!.fail();
    expect(sent).toHaveLength(3);
  });

  it('lets the heartbeat tick queue behind a slow request instead of piling up', async () => {
    const { reporter, sent } = setup();
    reporter.startHeartbeat();
    vi.advanceTimersByTime(PROGRESS_INTERVAL_MS * 3);
    expect(sent).toHaveLength(1);
    await sent[0]!.settle();
    expect(sent).toHaveLength(2);
    reporter.clearTimer();
  });

  it('drops a waiting report after the session is stopped', async () => {
    const { reporter, state, sent } = setup();
    reporter.send(false);
    reporter.send(false);
    state.stopped = true;
    reporter.dropPending();
    await sent[0]!.settle();
    expect(sent).toHaveLength(1);
  });

  it('drops a waiting report when the stop flag is set even without dropPending', async () => {
    const { reporter, state, sent } = setup();
    reporter.send(false);
    reporter.send(false);
    state.stopped = true;
    await sent[0]!.settle();
    expect(sent).toHaveLength(1);
  });

  it('drops the waiting report of a replaced session and gives the new one a free slot', async () => {
    const { reporter, state, sent } = setup();
    reporter.send(false);
    reporter.send(false);
    // The session is replaced (a restart): its report is gone, and the new one is not blocked.
    state.sessionId = 'session-2';
    reporter.reset();
    reporter.send(false);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ sessionId: 'session-2', body: { sequence: 1 } });

    // The old request's answer neither frees the new slot nor sends the dropped report.
    await sent[0]!.settle();
    expect(sent).toHaveLength(2);
    reporter.send(false);
    expect(sent).toHaveLength(2);
    await sent[1]!.settle();
    expect(sent).toHaveLength(3);
  });

  it('drops a waiting report whose session changed without a reset', async () => {
    const { reporter, state, sent } = setup();
    reporter.send(false);
    reporter.send(false);
    state.sessionId = 'session-2';
    await sent[0]!.settle();
    expect(sent).toHaveLength(1);
  });

  it('sends nothing without a session, a reading, or after a stop', () => {
    const { reporter, state, sent } = setup();
    state.sessionId = '';
    reporter.send(false);
    state.sessionId = 'session-1';
    state.reading = null;
    reporter.send(false);
    state.reading = { position: 1, paused: false };
    state.stopped = true;
    reporter.send(false);
    expect(sent).toHaveLength(0);
  });

  it('does not hold the slot for a report that had no reading', () => {
    const { reporter, state, sent } = setup();
    state.reading = null;
    reporter.send(false);
    state.reading = { position: 5, paused: false };
    reporter.send(false);
    expect(sent).toHaveLength(1);
  });

  it('still handles a 410 answer and then sends no waiting report', async () => {
    const { reporter, state, sent, deps } = setup();
    vi.mocked(deps.onEnded).mockImplementation(() => {
      state.stopped = true;
    });
    reporter.send(false);
    reporter.send(false);
    await sent[0]!.settle(410);
    expect(deps.onEnded).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(1);
  });
});
