// The buffering manager on its own, with stubbed dependencies and a fake clock: who may trigger
// when, what each answer does, what the timers leave behind and how the kept estimate behaves.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeEngine } from '../../test/fakeEngine';
import { playbackPlan } from '../../test/playbackFixtures';
import { BufferingManager, type BufferingView } from './BufferingManager';
import type { Plan, ReplanOptions, ReplanResult } from './types';

function plan(n: number, kbps?: number): Plan {
  return playbackPlan({
    plan_id: `plan:${n}`,
    plan_attempt_key: `v3:key-${n}`,
    effective_recipe: {
      video_codec: 'h264',
      audio_codec: 'aac',
      ...(kbps !== undefined ? { bitrate_kbps: kbps } : {}),
    },
    available_qualities: [
      { label: '1080p', preserves_source: false, bitrate_kbps: 8000 },
      { label: '720p', preserves_source: false, bitrate_kbps: 4000 },
    ],
  });
}

interface Made {
  mode?: 'never' | 'ask' | 'always';
  quality?: string | null;
  kbps?: number;
}

function make(options: Made = {}) {
  vi.useFakeTimers();
  const engine = new FakeEngine();
  engine.paused = false;
  const state = {
    stopped: false,
    replanning: false,
    recovery: false,
    quality: options.quality === undefined ? 'auto' : options.quality,
    mode: options.mode ?? 'always',
    plan: plan(1, 'kbps' in options ? options.kbps : 10_000),
  };
  const calls: { label: string; extra?: Pick<ReplanOptions, 'lowering' | 'restore'> }[] = [];
  /** What the next qualityChange does; the default adopts a lower plan. */
  const behaviour = {
    next: (async () => {
      state.plan = plan(2, 5000);
      return { kind: 'applied' };
    }) as () => Promise<ReplanResult>,
  };
  const views: BufferingView[] = [];
  const manager = new BufferingManager({
    settings: () => ({ feature: true, mode: state.mode }),
    plan: () => state.plan,
    quality: () => state.quality,
    engine: () => engine,
    isStopped: () => state.stopped,
    isReplanning: () => state.replanning,
    recoveryActive: () => state.recovery,
    qualityChange: (label, extra) => {
      calls.push({ label, extra });
      return behaviour.next();
    },
    onView: (view) => views.push(view),
  });
  manager.attach(engine);
  manager.started();
  manager.playing();
  const ctx = {
    engine,
    state,
    calls,
    behaviour,
    views,
    manager,
    view: () => views.at(-1) ?? { offer: null, notice: null },
    async wait(ms: number) {
      await vi.advanceTimersByTimeAsync(ms);
    },
    /** Waits `ms` with data arriving every second. */
    async hold(ms: number) {
      for (let left = ms; left > 0; left -= 1000) {
        engine.emit('data');
        await vi.advanceTimersByTimeAsync(Math.min(1000, left));
      }
    },
    async stall(ms: number) {
      engine.paused = false;
      engine.emit('data');
      manager.waiting();
      await vi.advanceTimersByTimeAsync(ms);
      manager.playing();
      await vi.advanceTimersByTimeAsync(1);
    },
    async twoStalls() {
      await ctx.stall(1500);
      await vi.advanceTimersByTimeAsync(1000);
      await ctx.stall(1500);
    },
  };
  return ctx;
}

/** A started manager that is past its startup grace. */
async function ready(options: Made = {}) {
  const ctx = make(options);
  await ctx.wait(10_001);
  return ctx;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('the kept estimate when a lowering is not applied', () => {
  it('a result that sent nothing (busy) keeps nothing', async () => {
    const ctx = await ready();
    ctx.behaviour.next = async () => ({ kind: 'busy' });
    await ctx.twoStalls();
    expect(ctx.calls).toHaveLength(1);
    expect(ctx.manager.keptKbps).toBeNull();
  });

  it('a result that sent nothing brings back the estimate from before', async () => {
    const ctx = await ready();
    await ctx.twoStalls();
    expect(ctx.manager.keptKbps).toBe(7000);
    ctx.manager.answer('hide');
    ctx.behaviour.next = async () => ({ kind: 'busy' });
    await ctx.stall(1500);
    expect(ctx.calls).toHaveLength(2);
    expect(ctx.manager.keptKbps).toBe(7000);
  });

  it.each(['transient', 'refused', 'loop'] as const)(
    'a replan that was sent and came back %s keeps the new estimate',
    async (kind) => {
      const ctx = await ready();
      ctx.behaviour.next = async () => ({ kind });
      await ctx.twoStalls();
      expect(ctx.calls).toHaveLength(1);
      expect(ctx.manager.keptKbps).toBe(7000);
    },
  );
});

describe('what a trigger may do', () => {
  it('a lowering that is no lower starts the 300 s cooldown and says so every time', async () => {
    const ctx = await ready();
    ctx.behaviour.next = async () => ({ kind: 'applied' });
    await ctx.twoStalls();
    expect(ctx.view().notice?.kind).toBe('cantLower');
    const first = ctx.view().notice;
    await ctx.wait(100_000);
    await ctx.twoStalls();
    expect(ctx.calls).toHaveLength(1);
    await ctx.wait(300_000);
    await ctx.twoStalls();
    expect(ctx.calls).toHaveLength(2);
    expect(ctx.view().notice).not.toBe(first);
  });

  it('is held back while another replan runs, and acts on the history afterwards', async () => {
    const ctx = await ready();
    ctx.state.replanning = true;
    await ctx.twoStalls();
    expect(ctx.calls).toHaveLength(0);
    expect(ctx.view().offer).toBeNull();
    ctx.state.replanning = false;
    await ctx.stall(1500);
    expect(ctx.calls).toHaveLength(1);
  });

  it('is held back while a reconnect runs', async () => {
    const ctx = await ready();
    await ctx.stall(1500);
    await ctx.wait(1000);
    ctx.engine.emit('data');
    ctx.manager.waiting();
    ctx.state.recovery = true;
    await ctx.wait(1500);
    ctx.manager.playing();
    expect(ctx.calls).toHaveLength(0);
  });

  it('counts nothing for a wait that begins during a reconnect', async () => {
    const ctx = await ready();
    ctx.state.recovery = true;
    ctx.manager.waiting();
    await ctx.hold(8000);
    ctx.state.recovery = false;
    expect(ctx.calls).toHaveLength(0);
  });

  it('is held back while a lowering is in flight', async () => {
    const ctx = await ready();
    let finish = () => {};
    ctx.behaviour.next = () =>
      new Promise<ReplanResult>((resolve) => {
        finish = () => {
          ctx.state.plan = plan(2, 5000);
          resolve({ kind: 'applied' });
        };
      });
    await ctx.twoStalls();
    await ctx.wait(1000);
    await ctx.stall(1500);
    expect(ctx.calls).toHaveLength(1);
    finish();
    await ctx.wait(1);
    expect(ctx.view().offer?.kind).toBe('undo');
  });

  it('takes a missing quality for Auto', async () => {
    const ctx = await ready({ quality: null });
    await ctx.twoStalls();
    expect(ctx.calls[0]).toMatchObject({
      label: 'auto',
      extra: { lowering: { estimateKbps: 7000 } },
    });
  });

  it('lowers at 143 kbit/s (estimate 100) and says nothing is lower at 142 (99)', async () => {
    const low = await ready({ kbps: 143 });
    await low.twoStalls();
    expect(low.calls[0]?.extra?.lowering?.estimateKbps).toBe(100);
    const none = await ready({ kbps: 142 });
    await none.twoStalls();
    expect(none.calls).toHaveLength(0);
    expect(none.view().notice?.kind).toBe('cantLower');
  });

  it('does nothing in never mode', async () => {
    const ctx = await ready({ mode: 'never' });
    await ctx.twoStalls();
    expect(ctx.calls).toHaveLength(0);
    expect(ctx.view().offer).toBeNull();
  });

  it('a rejected replan clears busy and watches again after 60 s with fresh history', async () => {
    const ctx = await ready();
    ctx.behaviour.next = () => Promise.reject(new Error('boom'));
    await ctx.twoStalls();
    expect(ctx.calls).toHaveLength(1);
    expect(ctx.view().offer).toBeNull();
    ctx.behaviour.next = async () => {
      ctx.state.plan = plan(2, 5000);
      return { kind: 'applied' };
    };
    // Held back for the minute.
    await ctx.wait(30_000);
    await ctx.twoStalls();
    expect(ctx.calls).toHaveLength(1);
    await ctx.wait(31_000);
    await ctx.twoStalls();
    expect(ctx.calls).toHaveLength(2);
  });

  it('a lowering that finishes after the session stopped shows nothing', async () => {
    const ctx = await ready();
    ctx.behaviour.next = async () => {
      ctx.state.stopped = true;
      ctx.state.plan = plan(2, 5000);
      return { kind: 'applied' };
    };
    await ctx.twoStalls();
    expect(ctx.view().offer).toBeNull();
    expect(ctx.view().notice).toBeNull();
  });

  it('does not lower for a long stall whose buffer filled up while it lasted', async () => {
    const ctx = await ready();
    ctx.engine.currentTime = 100;
    ctx.engine.buffered = [{ start: 0, end: 100 }];
    ctx.manager.waiting();
    ctx.engine.buffered = [{ start: 0, end: 106 }];
    await ctx.hold(6000);
    expect(ctx.calls).toHaveLength(0);
  });
});

describe('the prompt', () => {
  async function prompted() {
    const ctx = await ready({ mode: 'ask' });
    await ctx.twoStalls();
    expect(ctx.view().offer?.kind).toBe('prompt');
    return ctx;
  }

  it('Lower with nothing lower shows the notice and sends nothing', async () => {
    const ctx = await prompted();
    ctx.state.plan = plan(1);
    ctx.manager.answer('lower');
    expect(ctx.calls).toHaveLength(0);
    expect(ctx.view().notice?.kind).toBe('cantLower');
    expect(ctx.view().offer).toBeNull();
  });

  it('comes back no sooner than 120 s after it first showed, and each prompt has its own id', async () => {
    const ctx = await prompted();
    const first = ctx.view().offer!;
    ctx.manager.shown(first.id);
    await ctx.wait(15_000);
    ctx.manager.answer('expire');
    expect(ctx.view().offer).toBeNull();
    await ctx.wait(100_000);
    await ctx.twoStalls();
    expect(ctx.view().offer).toBeNull();
    await ctx.wait(10_000);
    await ctx.twoStalls();
    expect(ctx.view().offer?.kind).toBe('prompt');
    expect(ctx.view().offer?.id).not.toBe(first.id);
  });

  it('takes the first time the offer showed, and ignores the id of another offer', async () => {
    const ctx = await prompted();
    const offer = ctx.view().offer!;
    ctx.manager.shown(offer.id + 50);
    await ctx.wait(4000);
    ctx.manager.shown(offer.id);
    await ctx.wait(5000);
    ctx.manager.shown(offer.id);
    await ctx.wait(6000);
    ctx.manager.answer('expire');
    // Shown 4 s after it was offered: the next one may come from 124 s on (the offer is at 0 s).
    await ctx.wait(103_000);
    await ctx.twoStalls();
    expect(ctx.view().offer).toBeNull();
    await ctx.wait(4000);
    await ctx.stall(1500);
    expect(ctx.view().offer?.kind).toBe('prompt');
  });

  it('an answer with no offer does nothing', () => {
    const ctx = make();
    const before = ctx.views.length;
    expect(() => ctx.manager.answer('expire')).not.toThrow();
    ctx.manager.answer('keep');
    ctx.manager.pickSent();
    expect(ctx.views.length).toBe(before);
  });

  it('a pick sent takes the prompt away at once; applied, it starts the history over', async () => {
    const ctx = await prompted();
    ctx.manager.pickSent();
    expect(ctx.view().offer).toBeNull();
    ctx.manager.pickApplied();
    await ctx.wait(1000);
    // The two stalls before are forgotten: one more is not a pair.
    await ctx.stall(1500);
    expect(ctx.view().offer).toBeNull();
  });

  it('a new start takes the prompt away and needs the evidence again', async () => {
    const ctx = await prompted();
    ctx.manager.started();
    expect(ctx.view().offer).toBeNull();
    ctx.engine.emit('data');
    ctx.manager.waiting();
    await ctx.hold(20_000);
    expect(ctx.view().offer).toBeNull();
  });

  it('comes back on time for a stall that is already running when the wait ends', async () => {
    const ctx = await prompted();
    const first = ctx.view().offer!;
    ctx.manager.shown(first.id);
    await ctx.wait(15_000);
    ctx.manager.answer('expire');
    // The wait ends 120 s after the prompt showed.
    await ctx.wait(80_000);
    ctx.engine.emit('data');
    ctx.manager.waiting();
    await ctx.hold(24_000);
    expect(ctx.view().offer).toBeNull();
    await ctx.hold(1000);
    expect(ctx.view().offer?.kind).toBe('prompt');
    const id = ctx.view().offer!.id;
    await ctx.hold(5000);
    expect(ctx.view().offer?.id).toBe(id);
  });
});

describe('the undo pill and the notices', () => {
  it('the undo pill is hidden by its timeout, and the notice stays with an offer that comes after it', async () => {
    const ctx = await ready({ kbps: undefined });
    await ctx.twoStalls();
    expect(ctx.view().notice?.kind).toBe('cantLower');
    ctx.state.plan = plan(1, 10_000);
    await ctx.wait(310_000);
    await ctx.twoStalls();
    expect(ctx.view().offer?.kind).toBe('undo');
    expect(ctx.view().notice?.kind).toBe('cantLower');
    ctx.manager.answer('expire');
    expect(ctx.view().offer).toBeNull();
  });

  it('Restore answers the title and sends the undo', async () => {
    const ctx = await ready();
    await ctx.twoStalls();
    ctx.manager.answer('restore');
    expect(ctx.calls.at(-1)).toMatchObject({ label: 'auto', extra: { restore: true } });
    expect(ctx.manager.keptKbps).toBeNull();
  });
});

describe('the timers', () => {
  it('leave nothing behind after dispose, and a media-data event then does nothing', async () => {
    const ctx = await ready();
    const idle = vi.getTimerCount();
    ctx.manager.waiting();
    expect(vi.getTimerCount()).toBeGreaterThan(idle);
    ctx.manager.dispose();
    expect(vi.getTimerCount()).toBe(idle);
    ctx.engine.emit('data');
    ctx.engine.emit('seeked');
    expect(vi.getTimerCount()).toBe(idle);
  });

  it('a wait that begins after the session stopped arms nothing', async () => {
    const ctx = await ready();
    const idle = vi.getTimerCount();
    ctx.state.stopped = true;
    ctx.manager.waiting();
    expect(vi.getTimerCount()).toBe(idle);
  });

  it('two waits and then a frame leave no timer', async () => {
    const ctx = await ready();
    const idle = vi.getTimerCount();
    ctx.manager.waiting();
    ctx.manager.waiting();
    ctx.manager.playing();
    expect(vi.getTimerCount()).toBe(idle);
  });

  it.each(['paused', 'seeking', 'interrupted'] as const)(
    'a %s stops them and counts nothing',
    async (end) => {
      const ctx = await ready();
      const idle = vi.getTimerCount();
      ctx.manager.waiting();
      ctx.manager[end]();
      expect(vi.getTimerCount()).toBe(idle);
      await ctx.hold(8000);
      expect(ctx.calls).toHaveLength(0);
    },
  );

  it('an engine that was replaced no longer feeds the manager', async () => {
    const ctx = await ready();
    const next = new FakeEngine();
    next.paused = false;
    ctx.manager.attach(next);
    // A silent wait on the new engine is an outage; the old engine's data must not end it.
    ctx.manager.waiting();
    expect(ctx.engine.on).toBeDefined();
    await ctx.wait(5000);
    ctx.engine.emit('data');
    await ctx.wait(1500);
    expect(ctx.calls).toHaveLength(0);
  });
});

describe('what counts as media data and as a stall', () => {
  it('the first sample of a plan is no data, a shrink is none, and a missing range changes nothing', async () => {
    // Silent link: only a buffered end that grew past the last sample is data.
    const ctx = await ready();
    ctx.engine.currentTime = 100;
    ctx.engine.buffered = [{ start: 0, end: 100 }];
    ctx.manager.waiting(); // first sample: 100, not data
    await ctx.wait(4500);
    ctx.engine.buffered = [{ start: 0, end: 99 }]; // shrank
    await ctx.wait(1500);
    expect(ctx.calls).toHaveLength(0);

    // A buffer with no range around the playhead in between does not forget the last end.
    const gap = await ready();
    gap.engine.currentTime = 100;
    gap.engine.buffered = [{ start: 0, end: 100 }];
    gap.manager.playing(); // baseline 100
    gap.engine.buffered = [];
    gap.engine.emit('data');
    gap.manager.waiting(); // no range: the baseline stays
    let end = 100;
    for (let second = 0; second < 6; second += 1) {
      end += 0.1;
      gap.engine.buffered = [{ start: 0, end }];
      await gap.wait(1000);
    }
    expect(gap.calls).toHaveLength(1);
  });

  it('a reload of a played source buffers uncounted; a plan that plays on has its own grace', async () => {
    const reload = await ready();
    reload.manager.adopted(true);
    reload.engine.emit('data');
    reload.manager.waiting();
    await reload.hold(8000);
    expect(reload.calls).toHaveLength(0);

    const same = await ready();
    same.manager.adopted(false);
    same.engine.emit('data');
    same.manager.waiting();
    await same.hold(15_000);
    expect(same.calls).toHaveLength(0);
    await same.hold(2000);
    expect(same.calls).toHaveLength(1);
  });

  it('a seek stops the exemption only when the element is playing at seeked', async () => {
    const paused = await ready();
    paused.manager.seeking();
    paused.engine.paused = true;
    paused.engine.emit('seeked');
    paused.engine.paused = false;
    paused.engine.emit('data');
    paused.manager.waiting();
    await paused.hold(7000);
    expect(paused.calls).toHaveLength(0);
  });
});

describe('the buffered end as media data, round 5', () => {
  /** A playing manager whose buffered end is 100 s at the playhead. */
  async function baseline() {
    const ctx = await ready();
    ctx.engine.currentTime = 100;
    ctx.engine.buffered = [{ start: 0, end: 100 }];
    ctx.manager.playing();
    return ctx;
  }

  /**
   * The wait begins after 3 s of silence. Whatever the sample at its start finds must not count as
   * data (else the outage is timed from there): a data event 3 s into the wait finds the link
   * silent for 6 s (an outage), so the wait is timed again from it and nothing is lowered at 6.5 s.
   */
  async function waitAfterSilence(ctx: Awaited<ReturnType<typeof baseline>>) {
    ctx.manager.waiting();
    await ctx.wait(3000);
    ctx.engine.emit('data');
    await ctx.wait(3500);
    expect(ctx.calls).toHaveLength(0);
  }

  it('the jump of the buffered end after a seek is no data', async () => {
    const ctx = await baseline();
    await ctx.wait(3000);
    ctx.engine.currentTime = 500;
    ctx.engine.buffered = [
      { start: 0, end: 100 },
      { start: 450, end: 500.2 },
    ];
    ctx.manager.seeking();
    ctx.engine.emit('seeked');
    await waitAfterSilence(ctx);
  });

  it('the jump of the buffered end after an adoption is no data', async () => {
    const ctx = await baseline();
    ctx.engine.currentTime = 500;
    ctx.engine.buffered = [
      { start: 0, end: 100 },
      { start: 450, end: 500.2 },
    ];
    ctx.manager.adopted(false);
    await ctx.wait(3000);
    await waitAfterSilence(ctx);
  });

  it('a buffered end that shrank is no data', async () => {
    const ctx = await baseline();
    await ctx.wait(3000);
    ctx.engine.currentTime = 98;
    ctx.engine.buffered = [{ start: 0, end: 99 }];
    await waitAfterSilence(ctx);
  });

  it('a missing range between two samples does not make the next one a first sample', async () => {
    const ctx = await baseline();
    ctx.engine.buffered = [];
    ctx.engine.emit('data');
    ctx.manager.waiting(); // no range: the last end (100) stays
    ctx.engine.buffered = [{ start: 0, end: 100.5 }];
    await ctx.wait(1000); // the 1 s sample sees 100.5 > 100: data
    await ctx.wait(3500); // T + 4.5 s: the link was silent for 3.5 s only
    ctx.engine.emit('data');
    await ctx.wait(2000);
    // Not an outage at 4 s: the stall runs on from its start and lowered at 6 s.
    expect(ctx.calls).toHaveLength(1);
  });

  it('a grown buffer seen at playing and at waiting makes the wait a stall, not an outage', async () => {
    const ctx = await ready();
    ctx.engine.currentTime = 10;
    ctx.engine.buffered = [{ start: 0, end: 10 }];
    ctx.manager.playing(); // the end at 10 s
    await ctx.wait(5000);
    ctx.engine.currentTime = 19.5;
    ctx.engine.buffered = [{ start: 0, end: 20 }]; // grew, with no data event
    ctx.manager.waiting();
    for (let second = 0; second < 6; second += 1) {
      await ctx.wait(1000);
      ctx.engine.emit('data');
    }
    await ctx.wait(500);
    expect(ctx.calls).toHaveLength(1);
  });

  it('a frozen buffer for 4 s is an outage; growth ends it and the lowering comes 6 s after the growth', async () => {
    const ctx = await baseline();
    ctx.engine.emit('data');
    ctx.manager.waiting();
    await ctx.wait(4500);
    ctx.engine.buffered = [{ start: 0, end: 100.5 }];
    // The 1 s sample at 5 s sees the growth.
    await ctx.wait(500);
    for (let second = 0; second < 5; second += 1) {
      await ctx.wait(1000);
      ctx.engine.buffered = [{ start: 0, end: 101 + second }];
    }
    // 5 s after the growth: not yet.
    expect(ctx.calls).toHaveLength(0);
    await ctx.wait(1500);
    expect(ctx.calls).toHaveLength(1);
  });
});

describe('the recheck when a suppression ends, round 5', () => {
  async function undoShown() {
    const ctx = await ready();
    await ctx.twoStalls();
    expect(ctx.view().offer?.kind).toBe('undo');
    return ctx;
  }

  it('recovery active when a wait begins: nothing is counted, no prompt', async () => {
    const ctx = await ready({ mode: 'ask' });
    ctx.state.recovery = true;
    ctx.engine.emit('data');
    ctx.manager.waiting();
    await ctx.hold(7000);
    ctx.state.recovery = false;
    ctx.manager.playing();
    expect(ctx.calls).toHaveLength(0);
    expect(ctx.view().offer).toBeNull();
  });

  it('a wait that began before the reconnect, and is seen again during it, is ended', async () => {
    const ctx = await ready();
    ctx.engine.emit('data');
    ctx.manager.waiting();
    await ctx.hold(1000);
    ctx.state.recovery = true;
    ctx.manager.waiting();
    await ctx.hold(7000);
    ctx.state.recovery = false;
    ctx.manager.playing();
    expect(ctx.calls).toHaveLength(0);
  });

  it('a prompt that expires during a stall comes back when the wait ends, once', async () => {
    const ctx = await ready({ mode: 'ask' });
    await ctx.twoStalls();
    const first = ctx.view().offer!;
    ctx.manager.shown(first.id);
    // A stall begins while the prompt is up, and lasts.
    ctx.engine.emit('data');
    ctx.manager.waiting();
    await ctx.hold(15_000);
    ctx.manager.answer('expire');
    expect(ctx.view().offer).toBeNull();
    await ctx.hold(104_000);
    expect(ctx.view().offer).toBeNull();
    await ctx.hold(2000);
    expect(ctx.view().offer?.kind).toBe('prompt');
    const id = ctx.view().offer!.id;
    await ctx.hold(10_000);
    expect(ctx.view().offer?.id).toBe(id);
  });

  it('a pick applied during a stall times it again, and the lowering follows 6 s later', async () => {
    const ctx = await ready();
    ctx.engine.emit('data');
    ctx.manager.waiting();
    await ctx.hold(3000);
    ctx.manager.pickSent();
    ctx.manager.pickApplied();
    await ctx.hold(5000);
    expect(ctx.calls).toHaveLength(0);
    await ctx.hold(2000);
    expect(ctx.calls).toHaveLength(1);
  });

  it('a failed pick evaluates a long stall at once', async () => {
    const ctx = await ready();
    ctx.state.replanning = true;
    ctx.engine.emit('data');
    ctx.manager.waiting();
    await ctx.hold(7000);
    expect(ctx.calls).toHaveLength(0);
    ctx.state.replanning = false;
    ctx.manager.pickFailed();
    expect(ctx.calls).toHaveLength(1);
  });

  it('hiding the undo pill evaluates a long stall that ran behind it', async () => {
    const ctx = await undoShown();
    await ctx.wait(10_001);
    ctx.engine.emit('data');
    ctx.manager.waiting();
    await ctx.hold(7000);
    expect(ctx.calls).toHaveLength(1);
    ctx.manager.answer('hide');
    expect(ctx.calls).toHaveLength(2);
  });

  it('the rearm after a failed lowering times a stall that is running then', async () => {
    const ctx = await ready();
    ctx.behaviour.next = async () => ({ kind: 'transient' });
    await ctx.twoStalls();
    expect(ctx.calls).toHaveLength(1);
    ctx.behaviour.next = async () => {
      ctx.state.plan = plan(2, 5000);
      return { kind: 'applied' };
    };
    await ctx.hold(52_000);
    ctx.engine.emit('data');
    ctx.manager.waiting();
    // The wait over at 60 s clears the history: the stall is timed from there.
    await ctx.hold(15_000);
    expect(ctx.calls).toHaveLength(2);
  });

  it('a blocked trigger that is not in a wait sets no recheck timer', async () => {
    const ctx = await ready();
    ctx.behaviour.next = async () => ({ kind: 'applied' });
    await ctx.twoStalls();
    expect(ctx.view().notice?.kind).toBe('cantLower');
    await ctx.wait(1000);
    const idle = vi.getTimerCount();
    await ctx.stall(1500);
    expect(vi.getTimerCount()).toBe(idle);
  });
});

describe('the rearm timer, round 5', () => {
  it('dispose clears it', async () => {
    const ctx = await ready();
    const idle = vi.getTimerCount();
    ctx.behaviour.next = async () => ({ kind: 'transient' });
    await ctx.twoStalls();
    expect(vi.getTimerCount()).toBeGreaterThan(idle);
    ctx.manager.dispose();
    expect(vi.getTimerCount()).toBe(idle);
  });

  it('a lowering that rejects after the session stopped arms no rearm', async () => {
    const ctx = await ready();
    const idle = vi.getTimerCount();
    ctx.behaviour.next = async () => {
      ctx.state.stopped = true;
      throw new Error('boom');
    };
    await ctx.twoStalls();
    expect(vi.getTimerCount()).toBe(idle);
  });
});
