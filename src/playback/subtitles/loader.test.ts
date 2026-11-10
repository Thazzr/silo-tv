import { describe, expect, it, vi } from 'vitest';
import type { Transport } from '../../api/transport';
import type { components } from '../../api/generated/schema';
import { loadSubtitleCues, sidecarUrl } from './loader';

type Subtitle = components['schemas']['SubtitleDecisionV3'];

const BASE = 'https://silo.example';
const VTT = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhello\n';

function decision(over: Partial<Subtitle> & { url?: string; origin?: number } = {}): Subtitle {
  const { url = '/api/v2/stream/s1/subtitles/0.vtt?file_id=f1', origin = 0, ...rest } = over;
  return {
    mode: 'render',
    inventory: [],
    artifact: { url, mime_type: 'text/vtt', format: 'vtt', timing_origin_seconds: origin },
    ...rest,
  };
}

function transportReturning(body: string, init: ResponseInit = { status: 200 }) {
  return vi.fn<Transport>(async () => new Response(body, init));
}

describe('sidecarUrl', () => {
  it('is the artifact URL for render and convert, and null for off, burn_in, none or no artifact', () => {
    expect(sidecarUrl(decision())).toContain('/subtitles/0.vtt');
    expect(sidecarUrl(decision({ mode: 'convert' }))).toContain('/subtitles/0.vtt');
    expect(sidecarUrl(decision({ mode: 'burn_in' }))).toBeNull();
    expect(sidecarUrl(decision({ mode: 'off' }))).toBeNull();
    expect(sidecarUrl(decision({ mode: 'none' }))).toBeNull();
    expect(sidecarUrl({ mode: 'render', inventory: [] })).toBeNull();
    expect(sidecarUrl(undefined)).toBeNull();
  });
});

describe('loadSubtitleCues', () => {
  it('fetches through the transport with the token on the server origin and parses the cues', async () => {
    const transport = transportReturning(VTT);
    const cues = await loadSubtitleCues(decision(), { baseUrl: BASE, token: 'tok', transport });
    expect(cues).toHaveLength(1);
    expect(transport).toHaveBeenCalledTimes(1);
    const request = transport.mock.calls[0]![0];
    expect(request.method).toBe('GET');
    expect(request.url).toBe(`${BASE}/api/v2/stream/s1/subtitles/0.vtt?file_id=f1&token=tok`);
  });

  it('never sends the account token to another origin', async () => {
    const transport = transportReturning(VTT);
    const other = 'https://node.example/stream/s1/subtitles/0.vtt?file_id=f1&st=signed';
    const cues = await loadSubtitleCues(decision({ url: other }), {
      baseUrl: BASE,
      token: 'tok',
      transport,
    });
    expect(cues).toHaveLength(1);
    expect(transport.mock.calls[0]![0].url).toBe(other);
    expect(transport.mock.calls[0]![0].url).not.toContain('tok');
  });

  it('gives no cues, and does not throw, for a failed fetch, an error status or garbage', async () => {
    const options = { baseUrl: BASE, token: 'tok' };
    const failing = vi.fn<Transport>(async () => {
      throw new TypeError('network');
    });
    expect(await loadSubtitleCues(decision(), { ...options, transport: failing })).toEqual([]);
    expect(
      await loadSubtitleCues(decision(), {
        ...options,
        transport: transportReturning('nope', { status: 404 }),
      }),
    ).toEqual([]);
    expect(
      await loadSubtitleCues(decision(), { ...options, transport: transportReturning('<html>') }),
    ).toEqual([]);
  });

  it('gives no cues for an error status even when the body is valid WebVTT', async () => {
    const transport = transportReturning(VTT, { status: 404 });
    expect(await loadSubtitleCues(decision(), { baseUrl: BASE, token: 'tok', transport })).toEqual(
      [],
    );
  });

  it('fetches nothing for burn_in, off or a missing artifact', async () => {
    const transport = transportReturning(VTT);
    const options = { baseUrl: BASE, token: 'tok', transport };
    expect(await loadSubtitleCues(decision({ mode: 'burn_in' }), options)).toEqual([]);
    expect(await loadSubtitleCues({ mode: 'off', inventory: [] }, options)).toEqual([]);
    expect(transport).not.toHaveBeenCalled();
  });

  it('moves cues by a non-zero timing origin and leaves origin 0 alone', async () => {
    const transport = transportReturning(VTT);
    const options = { baseUrl: BASE, token: undefined, transport };
    const [plain] = await loadSubtitleCues(decision(), options);
    expect(plain!.start).toBe(1);
    const [moved] = await loadSubtitleCues(decision({ origin: 100 }), options);
    expect([moved!.start, moved!.end]).toEqual([101, 102]);
  });
});
