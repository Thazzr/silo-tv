import { describe, expect, it } from 'vitest';
import { isHlsStream } from './PlayerEngine';

describe('isHlsStream', () => {
  it('goes by the plan protocol or the MIME type, never the URL', () => {
    expect(isHlsStream({ protocol: 'hls' })).toBe(true);
    expect(isHlsStream({ protocol: 'http', mime_type: 'application/vnd.apple.mpegurl' })).toBe(
      true,
    );
    expect(isHlsStream({ protocol: 'http', mime_type: 'Application/Vnd.Apple.MpegURL' })).toBe(
      true,
    );
    expect(isHlsStream({ protocol: 'http', mime_type: 'video/mp4' })).toBe(false);
    expect(isHlsStream({ protocol: 'http' })).toBe(false);
  });
});
