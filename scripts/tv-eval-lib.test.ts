import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_EXPRESSION,
  DEFAULT_WAIT_FOR,
  createCdpClient,
  formatCpuProfileSummary,
  formatValue,
  parseArgs,
  parseInspectorUrl,
  parseProfileArgs,
  pickTarget,
  summarizeCpuProfile,
} from './tv-eval-lib.mjs';

describe('parseArgs', () => {
  it('uses the probe defaults and the device tv', () => {
    expect(parseArgs([], {})).toEqual({
      expression: DEFAULT_EXPRESSION,
      waitFor: DEFAULT_WAIT_FOR,
      timeoutSec: 60,
      device: 'tv',
      out: null,
    });
    expect(DEFAULT_EXPRESSION).toBe('JSON.stringify(window.__SILO_PROBE__ || null)');
    expect(DEFAULT_WAIT_FOR).toBe('window.__SILO_PROBE__ && window.__SILO_PROBE__.done');
  });

  it('takes the device from WEBOS_DEVICE and lets --device win', () => {
    expect(parseArgs([], { WEBOS_DEVICE: 'living-room' }).device).toBe('living-room');
    expect(parseArgs(['--device', 'bedroom'], { WEBOS_DEVICE: 'living-room' }).device).toBe(
      'bedroom',
    );
  });

  it('reads the expression and all flags', () => {
    expect(
      parseArgs(['document.title', '--wait-for', 'ready', '--timeout', '5', '--out', 'r.json'], {}),
    ).toMatchObject({
      expression: 'document.title',
      waitFor: 'ready',
      timeoutSec: 5,
      out: 'r.json',
    });
  });

  it('accepts flags before the expression', () => {
    expect(parseArgs(['--timeout', '2.5', 'location.href']).expression).toBe('location.href');
  });

  it.each([
    [['--timeout']],
    [['--timeout', 'abc']],
    [['--timeout', '0']],
    [['--bogus']],
    [['a', 'b']],
    [['--out']],
  ])('rejects %j', (argv) => {
    expect(() => parseArgs(argv)).toThrow();
  });
});

describe('parseInspectorUrl', () => {
  it.each([
    ['Application Debugging - http://localhost:51283', 'http://localhost:51283'],
    ['Application Debugging - http://192.168.1.50:9998\n', 'http://192.168.1.50:9998'],
    ['noise\nhttp://localhost:1234/devtools/inspector.html?ws=x\n', 'http://localhost:1234'],
  ])('finds the URL in %j', (text, expected) => {
    expect(parseInspectorUrl(text)).toBe(expected);
  });

  it.each(['', 'Launching the app', 'see http://localhost without port'])(
    'returns null for %j',
    (text) => {
      expect(parseInspectorUrl(text)).toBeNull();
    },
  );
});

describe('pickTarget', () => {
  const appId = 'io.github.thazzr.silotv';
  const page = (url: string, extra = {}) => ({ type: 'page', url, ...extra });

  it('prefers a page with index.html', () => {
    const wanted = page('file:///media/app/index.html');
    expect(pickTarget([page('about:blank'), wanted], appId)).toBe(wanted);
  });

  it('prefers a page whose url contains the app id', () => {
    const wanted = page(`file:///x/${appId}/main.html`);
    expect(pickTarget([page('about:blank'), wanted], appId)).toBe(wanted);
  });

  it('falls back to the first page', () => {
    const first = page('about:blank');
    expect(
      pickTarget([{ type: 'service_worker', url: 'index.html' }, first, page('x')], appId),
    ).toBe(first);
  });

  it('ignores non-page targets even when they match', () => {
    expect(pickTarget([{ type: 'worker', url: 'file:///index.html' }], appId)).toBeNull();
  });

  it('returns null without targets', () => {
    expect(pickTarget([], appId)).toBeNull();
    expect(pickTarget(undefined, appId)).toBeNull();
  });
});

describe('formatValue', () => {
  it('pretty-prints a JSON string', () => {
    expect(formatValue('{"a":1}')).toBe('{\n  "a": 1\n}');
  });
  it('passes plain strings through and serialises other values', () => {
    expect(formatValue('hello')).toBe('hello');
    expect(formatValue({ a: [1] })).toBe('{\n  "a": [\n    1\n  ]\n}');
    expect(formatValue(undefined)).toBe('undefined');
  });
});

class FakeSocket {
  sent: { id: number; method: string; params: Record<string, unknown> }[] = [];
  listeners: Record<string, ((event: unknown) => void)[]> = {};
  addEventListener(type: string, fn: (event: unknown) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  emit(type: string, event: unknown = {}) {
    for (const fn of this.listeners[type] ?? []) fn(event);
  }
  reply(message: object) {
    this.emit('message', { data: JSON.stringify(message) });
  }
}

describe('createCdpClient', () => {
  it('correlates responses with requests by id, whatever the order', async () => {
    const socket = new FakeSocket();
    const cdp = createCdpClient(socket);
    const first = cdp.send('A.one');
    const second = cdp.send('B.two', { x: 1 });
    expect(socket.sent.map((m) => [m.id, m.method, m.params])).toEqual([
      [1, 'A.one', {}],
      [2, 'B.two', { x: 1 }],
    ]);
    socket.reply({ id: 2, result: { v: 'second' } });
    socket.reply({ method: 'Some.event', params: {} });
    socket.reply({ id: 1, result: { v: 'first' } });
    await expect(first).resolves.toEqual({ v: 'first' });
    await expect(second).resolves.toEqual({ v: 'second' });
  });

  it('rejects with the error message of an error response', async () => {
    const socket = new FakeSocket();
    const cdp = createCdpClient(socket);
    const call = cdp.send('Bad.method');
    socket.reply({ id: 1, error: { code: -32601, message: "'Bad.method' wasn't found" } });
    await expect(call).rejects.toThrow("Bad.method: 'Bad.method' wasn't found");
  });

  it('evaluates with returnByValue and awaitPromise and returns the value', async () => {
    const socket = new FakeSocket();
    const cdp = createCdpClient(socket);
    const value = cdp.evaluate('1 + 1');
    expect(socket.sent[0]).toEqual({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression: '1 + 1', returnByValue: true, awaitPromise: true },
    });
    socket.reply({ id: 1, result: { result: { type: 'number', value: 2 } } });
    await expect(value).resolves.toBe(2);
  });

  it('surfaces exceptionDetails of Runtime.evaluate as an error', async () => {
    const socket = new FakeSocket();
    const cdp = createCdpClient(socket);
    const value = cdp.evaluate('boom()');
    socket.reply({
      id: 1,
      result: {
        result: { type: 'object' },
        exceptionDetails: {
          text: 'Uncaught',
          exception: { description: 'ReferenceError: boom is not defined' },
        },
      },
    });
    await expect(value).rejects.toThrow('ReferenceError: boom is not defined');
  });

  it('rejects pending requests when the socket closes', async () => {
    const socket = new FakeSocket();
    const cdp = createCdpClient(socket);
    const call = cdp.send('X.y');
    socket.emit('close');
    await expect(call).rejects.toThrow('closed');
  });

  it('rejects a request that gets no answer in time', async () => {
    vi.useFakeTimers();
    try {
      const cdp = createCdpClient(new FakeSocket(), { requestTimeoutMs: 100 });
      const call = cdp.send('X.y');
      const assertion = expect(call).rejects.toThrow('no response after 100 ms');
      await vi.advanceTimersByTimeAsync(100);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('parseProfileArgs', () => {
  const now = new Date('2026-11-09T10:20:30.456Z');

  it('defaults to 20 s, 1000 us, device tv and a timestamped file in perf-results', () => {
    expect(parseProfileArgs([], {}, now)).toEqual({
      seconds: 20,
      intervalUs: 1000,
      out: 'perf-results/tv-2026-11-09T10-20-30-456Z.cpuprofile',
      device: 'tv',
      waitFor: null,
      timeoutSec: 60,
    });
  });

  it('takes every option, WEBOS_DEVICE as default device', () => {
    const args = parseProfileArgs(
      ['--seconds', '8', '--interval', '500', '--out', 'x.cpuprofile', '--wait-for', 'window.ok'],
      { WEBOS_DEVICE: 'living-room' },
      now,
    );
    expect(args).toMatchObject({
      seconds: 8,
      intervalUs: 500,
      out: 'x.cpuprofile',
      device: 'living-room',
      waitFor: 'window.ok',
    });
    expect(parseProfileArgs(['--device', 'b'], { WEBOS_DEVICE: 'a' }, now).device).toBe('b');
  });

  it.each([
    [['--seconds', '0'], /positive number/],
    [['--seconds', 'abc'], /positive number/],
    [['--interval', '-5'], /positive number/],
    [['--seconds'], /needs a value/],
    [['--nope', '1'], /Unknown option/],
    [['stray'], /Unexpected argument/],
  ])('rejects %j', (argv, message) => {
    expect(() => parseProfileArgs(argv, {}, now)).toThrow(message);
  });
});

describe('summarizeCpuProfile', () => {
  const frame = (functionName: string, url = '', lineNumber = 0) => ({
    functionName,
    url,
    lineNumber,
    columnNumber: 0,
    scriptId: '1',
  });
  // root -> (idle) | (program) | (garbage collector) | A -> B -> B (recursion)
  const profile = {
    nodes: [
      { id: 1, callFrame: frame('(root)'), children: [2, 3, 4, 5] },
      { id: 2, callFrame: frame('(idle)') },
      { id: 3, callFrame: frame('(program)') },
      { id: 4, callFrame: frame('(garbage collector)') },
      { id: 5, callFrame: frame('A', 'file:///app/a.js?v=1', 0), children: [6] },
      { id: 6, callFrame: frame('B', 'file:///app/bundle.js', 9), children: [7] },
      { id: 7, callFrame: frame('B', 'file:///app/bundle.js', 9) },
    ],
    // Chrome: timeDeltas[i] is the gap before sample i, so sample i lasts timeDeltas[i + 1] us;
    // the last sample reuses its own delta.
    samples: [2, 6, 7, 3, 4, 5],
    timeDeltas: [0, 1000, 2000, 3000, 4000, 5000],
  };
  const summary = summarizeCpuProfile(profile);
  const byName = (list: { name: string; ms: number }[], name: string) =>
    list.find((e) => e.name === name)?.ms;

  it('splits idle, program and garbage collector out of the sampled time', () => {
    expect(summary.totalMs).toBeCloseTo(20);
    expect(summary.idleMs).toBeCloseTo(1);
    expect(summary.programMs).toBeCloseTo(4);
    expect(summary.gcMs).toBeCloseTo(5);
  });

  it('attributes self time to the sampled function, merging identical frames', () => {
    expect(byName(summary.topSelf, 'B')).toBeCloseTo(5); // nodes 6 and 7 are the same function
    expect(byName(summary.topSelf, 'A')).toBeCloseTo(5);
    expect(summary.topSelf[0].percent).toBeGreaterThan(0);
    expect(summary.topSelf.find((e) => e.name === 'B')).toMatchObject({
      file: 'bundle.js',
      line: 10,
    });
  });

  it('counts total time once per sample even for recursion', () => {
    expect(byName(summary.topTotal, 'B')).toBeCloseTo(5); // not 2 + 3 + 3
    expect(byName(summary.topTotal, 'A')).toBeCloseTo(10);
    expect(byName(summary.topTotal, '(root)')).toBeCloseTo(20);
  });

  it('totals self time per file, query string stripped, unnamed frames as (native)', () => {
    expect(Object.fromEntries(summary.files.map((f) => [f.file, f.ms]))).toEqual({
      '(native)': 10,
      'a.js': 5,
      'bundle.js': 5,
    });
  });

  it('limits the rankings', () => {
    expect(summarizeCpuProfile(profile, { topSelf: 1, topTotal: 2 })).toMatchObject({
      topSelf: [expect.anything()],
      topTotal: [expect.anything(), expect.anything()],
    });
  });

  it('copes with an empty profile and renders text', () => {
    const empty = summarizeCpuProfile({ nodes: [], samples: [], timeDeltas: [] });
    expect(empty.totalMs).toBe(0);
    const text = formatCpuProfileSummary(summary);
    expect(text).toContain('Top functions by self time');
    expect(text).toContain('B (bundle.js:10)');
    expect(text).toContain('Self time per file');
  });
});
