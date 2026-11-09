import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test, type CDPSession, type Page } from '@playwright/test';
import { startPerfServer } from './fakeServer.ts';

// The scroll profiling harness (npm run perf:scroll). It does not assert anything: it measures how
// much main-thread work a held arrow key costs and prints the numbers, so a change can be compared
// with the one before it. Set PERF_LABEL to name the result file (perf-results/scroll-<label>.json).
//
// Two passes per scenario, because counting renders slows the page down:
//   timing  - CPU throttled 6x, long tasks, slow frames and a CDP sampling profile;
//   renders - no throttle, React renders per key press (counted through the DevTools hook, which
//             a production build of React reports to as well).

const distPerf = fileURLToPath(new URL('../../dist-perf/index.html', import.meta.url));
const appUrl = pathToFileURL(distPerf).href;
const SPACING_MS = 180;
const THROTTLE = Number(process.env.PERF_THROTTLE ?? 6);

type Key = 'ArrowRight' | 'ArrowDown' | 'ArrowUp' | 'Enter';
type Press = (key: Key) => Promise<void>;

interface Scenario {
  name: string;
  /** Moves from the signed-in Home screen to the first card of the view under test. */
  enter: (press: Press, page: Page) => Promise<void>;
  /** The measured presses. */
  keys: Key[];
}

const repeat = (key: Key, n: number): Key[] => Array.from({ length: n }, () => key);

async function focusCard(press: Press, page: Page) {
  for (let i = 0; i < 8; i += 1) {
    const onCard = await page.evaluate<boolean>(
      "document.activeElement?.classList.contains('card') === true",
    );
    if (onCard) return;
    await press('ArrowDown');
  }
  throw new Error('no card got the focus');
}

const scenarios: Scenario[] = [
  {
    name: 'home',
    enter: (press, page) => focusCard(press, page),
    keys: [...repeat('ArrowRight', 15), ...repeat('ArrowDown', 6)],
  },
  {
    name: 'recommended',
    enter: async (press, page) => {
      await press('ArrowUp');
      await press('ArrowRight');
      await press('Enter');
      await page.getByTestId('recommended').waitFor();
      await focusCard(press, page);
    },
    keys: [...repeat('ArrowRight', 15), ...repeat('ArrowDown', 6)],
  },
  {
    name: 'browse',
    enter: async (press, page) => {
      await press('ArrowUp');
      await press('ArrowRight');
      await press('Enter');
      await page.getByTestId('recommended').waitFor();
      await press('ArrowDown');
      await press('ArrowRight');
      await press('Enter');
      await page.getByTestId('browse').waitFor();
      await page.getByTestId('grid-track').waitFor();
      await focusCard(press, page);
    },
    // Six columns: Right stops after five cards, so the grid also gets a run of Down presses.
    keys: [...repeat('ArrowRight', 15), ...repeat('ArrowDown', 12)],
  },
];

const initScript = `
(() => {
  const perf = { longtasks: [], frames: [], keys: [], running: false, counting: false, renders: {} };
  window.__perf = perf;
  new PerformanceObserver((list) => {
    if (!perf.running) return;
    for (const e of list.getEntries()) perf.longtasks.push(e.duration);
  }).observe({ entryTypes: ['longtask'] });
  // Event timing: a key press from the event to the next frame that shows its result.
  new PerformanceObserver((list) => {
    if (!perf.running) return;
    for (const e of list.getEntries()) if (e.name === 'keydown') perf.keys.push(e.duration);
  }).observe({ type: 'event', durationThreshold: 16, buffered: false });
  let last = 0;
  const tick = (now) => {
    if (perf.running && last) perf.frames.push(now - last);
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // React reports every commit to this hook, also in a production build. A fiber counts as
  // rendered when it performed work in this commit; subtrees that bailed out share their child
  // pointer with the previous tree and are skipped, like the React DevTools do.
  const FUNCTION_TAGS = [0, 11, 14, 15];
  const nameOf = (f) =>
    (f.type && (f.type.displayName || f.type.name || (f.type.type && f.type.type.name))) || 'anonymous';
  const count = (fiber, prev) => {
    if (FUNCTION_TAGS.includes(fiber.tag) && (fiber.flags & 1) === 1) {
      const n = nameOf(fiber);
      perf.renders[n] = (perf.renders[n] || 0) + 1;
    }
    if (prev && fiber.child === prev.child) return;
    for (let c = fiber.child; c; c = c.sibling) count(c, c.alternate);
  };
  let ids = 0;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    isDisabled: false,
    renderers: new Map(),
    inject(r) { ids += 1; this.renderers.set(ids, r); return ids; },
    onCommitFiberRoot(id, root) { if (perf.counting) count(root.current, root.current.alternate); },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
  };
})();
`;

interface Timing {
  longTasks: { count: number; totalMs: number; maxMs: number };
  frames: { count: number; over25: number; maxMs: number };
  /** Key press to the frame that shows it (Event Timing; presses under 16 ms are not reported). */
  keyToFrame: { reported: number; over50: number; maxMs: number };
  /** Main-thread time that was not idle, per press, from the CPU profile. */
  busyMsPerPress: number;
  /** Chrome's own counters over the run, per press (throttled time): where the main thread went. */
  metricsPerPress: Record<string, number>;
  profile: { fn: string; selfMs: number }[];
}

interface Profile {
  nodes: {
    id: number;
    callFrame: { functionName: string; url: string; lineNumber: number };
  }[];
  samples: number[];
  timeDeltas: number[];
}

interface PerfWindow {
  __perf: {
    running: boolean;
    counting: boolean;
    longtasks: number[];
    frames: number[];
    keys: number[];
    renders: Record<string, number>;
  };
}

function topSelfTime(profile: Profile, n: number): Timing['profile'] {
  const byNode = new Map<number, number>();
  profile.samples.forEach((id, i) => {
    byNode.set(id, (byNode.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0));
  });
  const byFn = new Map<string, number>();
  for (const node of profile.nodes) {
    const { functionName, url, lineNumber } = node.callFrame;
    const file = url.split('/').pop() ?? '';
    const key = `${functionName || '(anonymous)'} ${file}:${lineNumber + 1}`;
    byFn.set(key, (byFn.get(key) ?? 0) + (byNode.get(node.id) ?? 0));
  }
  return [...byFn.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([fn, us]) => ({ fn, selfMs: Math.round(us / 100) / 10 }));
}

function busyMs(profile: Profile): number {
  const idle = new Set(
    profile.nodes.filter((n) => n.callFrame.functionName === '(idle)').map((n) => n.id),
  );
  let us = 0;
  profile.samples.forEach((id, i) => {
    if (!idle.has(id)) us += profile.timeDeltas[i] ?? 0;
  });
  return Math.round(us / 100) / 10;
}

const METRICS = [
  'TaskDuration',
  'ScriptDuration',
  'LayoutDuration',
  'RecalcStyleDuration',
  'LayoutCount',
  'RecalcStyleCount',
];

async function metrics(cdp: CDPSession): Promise<Record<string, number>> {
  const { metrics: list } = await cdp.send('Performance.getMetrics');
  const out: Record<string, number> = {};
  for (const m of list) {
    if (!METRICS.includes(m.name)) continue;
    // The durations are in seconds.
    out[m.name] = m.name.endsWith('Duration') ? m.value * 1000 : m.value;
  }
  return out;
}

async function openScenario(page: Page, origin: string, scenario: Scenario) {
  const press: Press = async (key) => {
    await page.keyboard.press(key);
    await page.waitForTimeout(150);
  };
  await page.goto(`${appUrl}?server=${origin}`);
  await page.getByLabel('Serveradresse').waitFor();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.getByTestId('hero-title').waitFor({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  await scenario.enter(press, page);
  await page.waitForTimeout(1500);
}

async function measureTiming(page: Page, cdp: CDPSession, keys: Key[]): Promise<Timing> {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
  await page.evaluate(() => {
    (globalThis as unknown as PerfWindow).__perf.running = true;
  });
  await cdp.send('Performance.enable');
  const before = await metrics(cdp);
  await cdp.send('Profiler.start');
  const t0 = Date.now();
  for (const [i, key] of keys.entries()) {
    const wait = t0 + i * SPACING_MS - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);
    await page.keyboard.press(key);
  }
  await page.waitForTimeout(600);
  const { profile } = await cdp.send('Profiler.stop');
  const after = await metrics(cdp);
  const raw = await page.evaluate(() => {
    const p = (globalThis as unknown as PerfWindow).__perf;
    p.running = false;
    return { longtasks: p.longtasks, frames: p.frames, keys: p.keys };
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const max = (a: number[]) => a.reduce((x, y) => Math.max(x, y), 0);
  return {
    longTasks: {
      count: raw.longtasks.length,
      totalMs: Math.round(sum(raw.longtasks)),
      maxMs: Math.round(max(raw.longtasks)),
    },
    frames: {
      count: raw.frames.length,
      over25: raw.frames.filter((f) => f > 25).length,
      maxMs: Math.round(max(raw.frames)),
    },
    keyToFrame: {
      reported: raw.keys.length,
      over50: raw.keys.filter((k) => k > 50).length,
      maxMs: Math.round(max(raw.keys)),
    },
    metricsPerPress: Object.fromEntries(
      Object.keys(after).map((name) => [
        name,
        Math.round((((after[name] ?? 0) - (before[name] ?? 0)) / keys.length) * 100) / 100,
      ]),
    ),
    busyMsPerPress: busyMs(profile as unknown as Profile) / keys.length,
    profile: topSelfTime(profile as unknown as Profile, 15),
  };
}

async function measureRenders(page: Page, keys: Key[]) {
  const take = () =>
    page.evaluate(() => {
      const p = (globalThis as unknown as PerfWindow).__perf;
      const out = p.renders;
      p.renders = {};
      return out;
    });
  await page.evaluate(() => {
    (globalThis as unknown as PerfWindow).__perf.counting = true;
  });
  await take();
  const total: Record<string, number> = {};
  const perPress: number[] = [];
  for (const key of keys) {
    await page.keyboard.press(key);
    await page.waitForTimeout(SPACING_MS + 120);
    const r = await take();
    perPress.push(Object.values(r).reduce((a, b) => a + b, 0));
    for (const [name, n] of Object.entries(r)) total[name] = (total[name] ?? 0) + n;
  }
  const avg = perPress.reduce((a, b) => a + b, 0) / Math.max(1, perPress.length);
  const byComponent = Object.fromEntries(
    Object.entries(total)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([name, n]) => [name, Math.round((n / keys.length) * 10) / 10]),
  );
  return {
    avgPerPress: Math.round(avg * 10) / 10,
    maxPerPress: Math.max(...perPress),
    byComponent,
  };
}

const results: Record<string, unknown> = {};

for (const scenario of scenarios) {
  test(`scroll profile: ${scenario.name}`, async ({ browser }) => {
    const server = await startPerfServer();
    try {
      // Pass 1: timing.
      const timingContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      const timingPage = await timingContext.newPage();
      await timingPage.addInitScript(initScript);
      await openScenario(timingPage, server.origin, scenario);
      const cdp = await timingContext.newCDPSession(timingPage);
      const timing = await measureTiming(timingPage, cdp, scenario.keys);
      await timingContext.close();

      // Pass 2: renders.
      const renderContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      const renderPage = await renderContext.newPage();
      await renderPage.addInitScript(initScript);
      await openScenario(renderPage, server.origin, scenario);
      const renders = await measureRenders(renderPage, scenario.keys);
      await renderContext.close();

      results[scenario.name] = { presses: scenario.keys.length, timing, renders };
      const lt = timing.longTasks;
      const fr = timing.frames;
      console.log(`\n=== ${scenario.name} (${scenario.keys.length} presses, ${THROTTLE}x CPU) ===`);
      console.log(`long tasks: ${lt.count}, total ${lt.totalMs} ms, max ${lt.maxMs} ms`);
      console.log(`frames: ${fr.count}, over 25 ms: ${fr.over25}, max ${fr.maxMs} ms`);
      const kf = timing.keyToFrame;
      console.log(
        `key to frame (>=16 ms reported): ${kf.reported} of ${scenario.keys.length}, over 50 ms: ${kf.over50}, max ${kf.maxMs} ms; busy ${timing.busyMsPerPress.toFixed(1)} ms per press`,
      );
      console.log(
        `renders per press: avg ${renders.avgPerPress}, max ${renders.maxPerPress}; by component per press:`,
        JSON.stringify(renders.byComponent),
      );
      console.log('per press (ms or count):', JSON.stringify(timing.metricsPerPress));
      console.log('self time top 15:');
      for (const row of timing.profile) {
        console.log(`  ${String(row.selfMs).padStart(8)} ms  ${row.fn}`);
      }
    } finally {
      await server.close();
    }
  });
}

test.afterAll(() => {
  const dir = fileURLToPath(new URL('../../perf-results/', import.meta.url));
  mkdirSync(dir, { recursive: true });
  const label = process.env.PERF_LABEL ?? 'run';
  writeFileSync(`${dir}scroll-${label}.json`, JSON.stringify(results, null, 2));
});
