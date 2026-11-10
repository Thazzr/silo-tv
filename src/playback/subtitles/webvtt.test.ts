import { describe, expect, it } from 'vitest';
import { parseWebVtt, type Run } from './webvtt';

const run = (text: string, style: Partial<Run> = {}): Run => ({
  text,
  italic: false,
  bold: false,
  underline: false,
  ...style,
});

describe('parseWebVtt', () => {
  it('reads cue timings with and without hours', () => {
    const cues = parseWebVtt(
      [
        'WEBVTT',
        '',
        '00:01.500 --> 00:03.250',
        'Short form',
        '',
        '01:02:03.004 --> 01:02:05.000',
        'Long form',
        '',
        '100:00:00.000 --> 100:00:01.000',
        'Past ninety-nine hours',
      ].join('\n'),
    );
    expect(cues.map((c) => [c.start, c.end])).toEqual([
      [1.5, 3.25],
      [3723.004, 3725],
      [360000, 360001],
    ]);
  });

  it('keeps the lines of a multi-line cue and reads CRLF files and a BOM', () => {
    const cues = parseWebVtt(
      '﻿WEBVTT\r\n\r\n1\r\n00:00:01.000 --> 00:00:02.000\r\nfirst\r\nsecond\r\n',
    );
    expect(cues).toHaveLength(1);
    expect(cues[0]!.lines).toEqual([[run('first')], [run('second')]]);
  });

  it('skips NOTE, STYLE and REGION blocks and the header text', () => {
    const cues = parseWebVtt(
      [
        'WEBVTT - a title',
        'Kind: captions',
        '',
        'STYLE',
        '::cue { color: red }',
        '',
        'REGION',
        'id:r1',
        '',
        'NOTE this is --> not a cue',
        'still a note',
        '',
        '00:00:01.000 --> 00:00:02.000 line:90% align:center',
        'real',
      ].join('\n'),
    );
    expect(cues).toHaveLength(1);
    expect(cues[0]!.lines).toEqual([[run('real')]]);
  });

  it('skips a NOTE, STYLE or REGION block even when a line in it looks like a timing line', () => {
    for (const kind of ['NOTE', 'STYLE', 'REGION']) {
      const cues = parseWebVtt(`WEBVTT\n\n${kind}\n00:01.000 --> 00:02.000\nhidden\n`);
      expect(cues, kind).toEqual([]);
    }
  });

  it('maps i, b and u to flags, nested, and drops the other WebVTT tags but keeps their text', () => {
    const [cue] = parseWebVtt(
      [
        'WEBVTT',
        '',
        '00:00:01.000 --> 00:00:02.000',
        '<i>slanted <b>and bold</b></i> <u>under</u> <c.yellow>c</c> <v Bob>v</v> <00:00:01.500>t',
      ].join('\n'),
    );
    expect(cue!.lines[0]).toEqual([
      run('slanted ', { italic: true }),
      run('and bold', { italic: true, bold: true }),
      run(' '),
      run('under', { underline: true }),
      run(' c v t'),
    ]);
  });

  it('keeps a tag that is not WebVTT as literal text', () => {
    const [cue] = parseWebVtt(
      [
        'WEBVTT',
        '',
        '00:00:01.000 --> 00:00:02.000',
        '<script>alert(1)</script> &lt;b&gt; &amp;',
      ].join('\n'),
    );
    expect(cue!.lines[0]).toEqual([run('<script>alert(1)</script> <b> &')]);
  });

  it('returns no cues without the WEBVTT header, and ignores malformed or empty cues', () => {
    expect(parseWebVtt('00:00:01.000 --> 00:00:02.000\nhi')).toEqual([]);
    expect(parseWebVtt('')).toEqual([]);
    const cues = parseWebVtt(
      [
        'WEBVTT',
        '',
        '00:00:05.000 --> 00:00:04.000',
        'backwards',
        '',
        '00:00:01.000 --> 00:00:02.000',
        '',
        '',
        '00:00:01 --> 00:00:02',
        'bad timing',
        '',
        '00:00:09.000 --> 00:00:10.000',
        'kept',
      ].join('\n'),
    );
    expect(cues.map((c) => c.lines[0]![0]!.text)).toEqual(['kept']);
  });

  it('returns the cues in start order', () => {
    const cues = parseWebVtt(
      [
        'WEBVTT',
        '',
        '00:00:09.000 --> 00:00:10.000',
        'b',
        '',
        '00:00:01.000 --> 00:00:02.000',
        'a',
      ].join('\n'),
    );
    expect(cues.map((c) => c.start)).toEqual([1, 9]);
  });
});
