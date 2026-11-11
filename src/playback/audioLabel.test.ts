import { describe, expect, it } from 'vitest';
import type { S } from './session/types';
import { audioCodecBadge } from './audioLabel';

const audio = (overrides: Partial<S['WatchAudioTrack']> = {}): S['WatchAudioTrack'] => ({
  default: false,
  ...overrides,
});

describe('the audio codec badge', () => {
  it.each([
    [{ codec: 'eac3' }, 'EAC3'],
    [{ codec: 'E-AC-3' }, 'EAC3'],
    [{ codec: 'eac3', profile: 'Dolby Digital Plus + Dolby Atmos' }, 'DD+ Atmos'],
    [{ codec: 'eac3', embedded_title: 'DD+ 7.1 Atmos' }, 'DD+ Atmos'],
    [{ codec: 'truehd' }, 'TrueHD'],
    [{ codec: 'truehd', title: 'Atmos' }, 'TrueHD Atmos'],
    [{ codec: 'dts-hd' }, 'DTS-HD'],
    [{ codec: 'dts:x' }, 'DTS-HD'],
    [{ codec: 'dts' }, 'DTS'],
    [{ codec: 'aac' }, 'AAC'],
    [{ codec: 'flac' }, 'FLAC'],
    [{ codec: 'ac3' }, 'AC3'],
    [{ codec: 'opus' }, 'OPUS'],
  ])('writes %j as %s', (fields, badge) => {
    expect(audioCodecBadge(audio(fields))).toBe(badge);
  });

  it('names Atmos from the codec itself, and as the bare word for another carrier', () => {
    expect(audioCodecBadge(audio({ codec: 'truehd_atmos' }))).toBe('TrueHD Atmos');
    expect(audioCodecBadge(audio({ codec: 'atmos' }))).toBe('Atmos');
    expect(audioCodecBadge(audio({ codec: 'mystery', profile: 'Atmos' }))).toBe('Atmos');
  });

  it('does not take a title for Atmos on a codec that cannot carry it', () => {
    expect(audioCodecBadge(audio({ codec: 'aac', title: 'AAC 2.0 (from TrueHD Atmos)' }))).toBe(
      'AAC',
    );
    expect(audioCodecBadge(audio({ codec: 'ac3', profile: 'Atmos' }))).toBe('AC3');
    expect(audioCodecBadge(audio({ codec: 'dts', title: 'Atmos' }))).toBe('DTS');
  });

  // Each of these cannot carry Atmos: a title or profile that says so is a compatibility track.
  it.each([
    ['ac-3', 'AC-3'],
    ['ac3', 'AC3'],
    ['aac', 'AAC'],
    ['dts', 'DTS'],
    ['flac', 'FLAC'],
    ['mp3', 'MP3'],
    ['opus', 'OPUS'],
    ['vorbis', 'VORBIS'],
    ['pcm_s16le', 'PCM_S16LE'],
    ['alac', 'ALAC'],
  ])('gives %s no Atmos badge for "Atmos" in its title or its profile', (codec, badge) => {
    expect(audioCodecBadge(audio({ codec, title: 'Atmos 7.1' }))).toBe(badge);
    expect(audioCodecBadge(audio({ codec, profile: 'Dolby Atmos' }))).toBe(badge);
  });

  it.each([
    ['dts-es', 'DTS'],
    ['dts_hd_ma', 'DTS'],
    ['dts-hd.ma', 'DTS-HD'],
    ['dts:x', 'DTS-HD'],
    ['aac_latm', 'AAC'],
    ['flac_ogg', 'FLAC'],
    ['e-ac-3', 'EAC3'],
    ['truehd_x', 'TrueHD'],
  ])('keeps the web mapping for the codec variant %s: %s', (codec, badge) => {
    expect(audioCodecBadge(audio({ codec }))).toBe(badge);
  });

  it('needs Atmos as a word: "Atmospheric" is no evidence', () => {
    expect(audioCodecBadge(audio({ codec: 'eac3', title: 'Atmospheric mix' }))).toBe('EAC3');
  });

  it('has no badge without a codec', () => {
    expect(audioCodecBadge(audio())).toBeNull();
    expect(audioCodecBadge(audio({ codec: '  ' }))).toBeNull();
  });
});
