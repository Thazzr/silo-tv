import { describe, expect, it } from 'vitest';
import {
  audioCodecName,
  channelLayout,
  formatBitrate,
  formatFileSize,
  formatFrameRate,
  formatSampleRate,
  isAudioCodecWord,
  profileName,
  videoCodecName,
} from './infoFormat';

describe('videoCodecName', () => {
  it.each([
    ['h264', 'H.264'],
    ['H264', 'H.264'],
    ['avc1', 'H.264'],
    ['hevc', 'HEVC'],
    ['h265', 'HEVC'],
    ['av1', 'AV1'],
    ['vp9', 'VP9'],
    ['mpeg2video', 'MPEG-2'],
    ['somethingnew', 'SOMETHINGNEW'],
  ])('%s is %s', (codec, name) => {
    expect(videoCodecName(codec)).toBe(name);
  });

  it('is null for a blank codec', () => {
    expect(videoCodecName('  ')).toBeNull();
    expect(videoCodecName(undefined)).toBeNull();
  });
});

describe('audioCodecName', () => {
  it.each([
    ['aac', 'AAC'],
    ['ac3', 'AC-3'],
    ['eac3', 'E-AC-3'],
    ['E-AC-3', 'E-AC-3'],
    ['dts', 'DTS'],
    ['truehd', 'TrueHD'],
    ['flac', 'FLAC'],
    ['opus', 'Opus'],
    ['mp3', 'MP3'],
    ['pcm_s16le', 'PCM'],
    ['wmapro', 'WMAPRO'],
  ])('%s is %s', (codec, name) => {
    expect(audioCodecName(codec)).toBe(name);
  });

  it('is null for a missing codec', () => {
    expect(audioCodecName('')).toBeNull();
    expect(audioCodecName(null)).toBeNull();
  });
});

describe('channelLayout', () => {
  it('reads the layout string first, ignoring the channel positions', () => {
    expect(channelLayout(6, '5.1(side)')).toBe('5.1');
    expect(channelLayout(8, '7.1')).toBe('7.1');
    expect(channelLayout(2, 'stereo')).toBe('Stereo');
    expect(channelLayout(1, 'mono')).toBe('Mono');
    // The layout wins over the count.
    expect(channelLayout(8, '5.1')).toBe('5.1');
  });

  it('falls back to the channel count', () => {
    expect(channelLayout(1)).toBe('Mono');
    expect(channelLayout(2)).toBe('Stereo');
    expect(channelLayout(6)).toBe('5.1');
    expect(channelLayout(8)).toBe('7.1');
    expect(channelLayout(3, 'unknown')).toBe('3 ch');
  });

  it('is null when nothing is known', () => {
    expect(channelLayout(undefined)).toBeNull();
    expect(channelLayout(0)).toBeNull();
  });
});

describe('formatBitrate', () => {
  it('writes Mbit/s from 1000 kbit/s and kbit/s below, with one decimal at most', () => {
    expect(formatBitrate(800)).toBe('800 kbit/s');
    expect(formatBitrate(999)).toBe('999 kbit/s');
    expect(formatBitrate(1000)).toBe('1 Mbit/s');
    expect(formatBitrate(4000)).toBe('4 Mbit/s');
    expect(formatBitrate(8450)).toBe('8.5 Mbit/s');
    expect(formatBitrate(192)).toBe('192 kbit/s');
  });

  it('uses the decimal comma of German', () => {
    expect(formatBitrate(8450, ',')).toBe('8,5 Mbit/s');
    expect(formatBitrate(800, ',')).toBe('800 kbit/s');
  });

  it('is null for a missing or empty value', () => {
    expect(formatBitrate(undefined)).toBeNull();
    expect(formatBitrate(null)).toBeNull();
    expect(formatBitrate(0)).toBeNull();
    expect(formatBitrate(Number.NaN)).toBeNull();
  });
});

describe('formatFileSize', () => {
  it('writes MB below a gigabyte and GB above', () => {
    expect(formatFileSize(5 * 1024 ** 2)).toBe('5 MB');
    expect(formatFileSize(850 * 1024 ** 2)).toBe('850 MB');
    expect(formatFileSize(1024 ** 3)).toBe('1 GB');
    expect(formatFileSize(4.2 * 1024 ** 3)).toBe('4.2 GB');
    expect(formatFileSize(4.2 * 1024 ** 3, ',')).toBe('4,2 GB');
  });

  it('reads in MB up to 1023 MB and in GB from 1024 MB on', () => {
    expect(formatFileSize(1010 * 1024 ** 2)).toBe('1010 MB');
    expect(formatFileSize(1023 * 1024 ** 2)).toBe('1023 MB');
    expect(formatFileSize(1024 * 1024 ** 2)).toBe('1 GB');
  });

  it('shows a tiny file as 1 MB and an unknown one as null', () => {
    expect(formatFileSize(1000)).toBe('1 MB');
    expect(formatFileSize(0)).toBeNull();
    expect(formatFileSize(undefined)).toBeNull();
  });
});

describe('formatFrameRate', () => {
  it('writes up to three decimals without trailing zeros, with the language separator', () => {
    expect(formatFrameRate(24)).toBe('24');
    expect(formatFrameRate(23.976023976)).toBe('23.976');
    expect(formatFrameRate(23.976023976, ',')).toBe('23,976');
    expect(formatFrameRate(29.97, ',')).toBe('29,97');
    expect(formatFrameRate(59.94)).toBe('59.94');
  });

  it('is null when unknown', () => {
    expect(formatFrameRate(0)).toBeNull();
    expect(formatFrameRate(undefined)).toBeNull();
  });
});

describe('formatSampleRate', () => {
  it('writes kHz with the language separator', () => {
    expect(formatSampleRate(48000)).toBe('48 kHz');
    expect(formatSampleRate(44100)).toBe('44.1 kHz');
    expect(formatSampleRate(44100, ',')).toBe('44,1 kHz');
    expect(formatSampleRate(96000)).toBe('96 kHz');
  });

  it('is null when unknown', () => {
    expect(formatSampleRate(undefined)).toBeNull();
    expect(formatSampleRate(0)).toBeNull();
  });
});

describe('profileName', () => {
  it('capitalises the words of a profile', () => {
    expect(profileName('high')).toBe('High');
    expect(profileName('High')).toBe('High');
    expect(profileName('main 10')).toBe('Main 10');
    expect(profileName('BASELINE')).toBe('Baseline');
    expect(profileName(' constrained baseline ')).toBe('Constrained Baseline');
  });

  it('splits on any run of white space', () => {
    expect(profileName('main  10')).toBe('Main 10');
    expect(profileName('main\t10')).toBe('Main 10');
  });

  it('is null when blank', () => {
    expect(profileName('  ')).toBeNull();
    expect(profileName(undefined)).toBeNull();
  });
});

describe('isAudioCodecWord', () => {
  it('knows codec ids and their written names', () => {
    for (const word of [
      'AC3',
      'ac-3',
      'E-AC-3',
      'eac3',
      'DTS',
      'AAC',
      'TrueHD',
      'FLAC',
      'pcm_s16le',
    ]) {
      expect(isAudioCodecWord(word), word).toBe(true);
    }
    expect(isAudioCodecWord('Kommentar')).toBe(false);
    expect(isAudioCodecWord('')).toBe(false);
  });
});
