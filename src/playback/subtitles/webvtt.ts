// A small WebVTT reader for the sidecars Silo serves (`text/vtt`, absolute source timestamps).
// It yields plain data only: cue text becomes runs of text with three style flags, so nothing the
// file says ever reaches the DOM as markup.

/** A stretch of cue text with the inline styles the three basic tags give it. */
export interface Run {
  text: string;
  italic: boolean;
  bold: boolean;
  underline: boolean;
}

export interface Cue {
  /** Seconds on the source's timeline. */
  start: number;
  end: number;
  /** Line breaks of the cue are kept: one entry per line. */
  lines: Run[][];
}

const TIMING =
  /^(?:(\d+):)?([0-5]\d):([0-5]\d)[.,](\d{3})\s+-->\s+(?:(\d+):)?([0-5]\d):([0-5]\d)[.,](\d{3})(?:\s.*)?$/;

function seconds(hours: string | undefined, minutes: string, secs: string, millis: string): number {
  return Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(secs) + Number(millis) / 1000;
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&nbsp;': ' ',
  '&lrm;': '‎',
  '&rlm;': '‏',
};

function decode(text: string): string {
  return text.replace(/&(?:amp|lt|gt|nbsp|lrm|rlm);/g, (entity) => ENTITIES[entity] ?? entity);
}

// Tags WebVTT defines: the three style tags are mapped, the rest is dropped and its text kept.
// Anything else that looks like a tag (<script>, <img ...>) is not WebVTT and stays literal text.
const STYLE_TAG = /^<(\/?)([ibu])(?:\.[^\s>]*)*>/;
const DROPPED_TAG =
  /^<\/?(?:c|v|lang|ruby|rt)(?:\.[^\s>]*)*(?:\s[^>]*)?>|^<(?:\d+:)?\d{2}:\d{2}\.\d{3}>/;

function parseLine(line: string): Run[] {
  const runs: Run[] = [];
  let italic = 0;
  let bold = 0;
  let underline = 0;
  let buffer = '';
  const flush = () => {
    if (buffer === '') return;
    runs.push({
      text: decode(buffer),
      italic: italic > 0,
      bold: bold > 0,
      underline: underline > 0,
    });
    buffer = '';
  };
  let i = 0;
  while (i < line.length) {
    if (line[i] === '<') {
      const rest = line.slice(i);
      const style = STYLE_TAG.exec(rest);
      if (style) {
        flush();
        const delta = style[1] === '/' ? -1 : 1;
        if (style[2] === 'i') italic = Math.max(0, italic + delta);
        else if (style[2] === 'b') bold = Math.max(0, bold + delta);
        else underline = Math.max(0, underline + delta);
        i += style[0].length;
        continue;
      }
      const dropped = DROPPED_TAG.exec(rest);
      if (dropped) {
        i += dropped[0].length;
        continue;
      }
    }
    buffer += line[i];
    i += 1;
  }
  flush();
  return runs;
}

/** The cues of a WebVTT document in start order; a text without the WEBVTT header has none. */
export function parseWebVtt(input: string): Cue[] {
  // A byte order mark in front of the header is allowed.
  const text = (input.charCodeAt(0) === 0xfeff ? input.slice(1) : input).replace(/\r\n?/g, '\n');
  const blocks = text.split(/\n{2,}/);
  const header = blocks[0]?.split('\n')[0] ?? '';
  if (!/^WEBVTT(?:[ \t].*)?$/.test(header)) return [];

  const cues: Cue[] = [];
  for (const block of blocks.slice(1)) {
    const lines = block.split('\n');
    const first = lines[0] ?? '';
    if (/^(?:NOTE|STYLE|REGION)(?:[ \t]|$)/.test(first)) continue;
    // An optional identifier line comes before the timing line.
    const at = lines.findIndex((l) => l.includes('-->'));
    if (at < 0 || at > 1) continue;
    const timing = TIMING.exec((lines[at] ?? '').trim());
    if (!timing) continue;
    const start = seconds(timing[1], timing[2]!, timing[3]!, timing[4]!);
    const end = seconds(timing[5], timing[6]!, timing[7]!, timing[8]!);
    const body = lines.slice(at + 1);
    while (body.length > 0 && body[body.length - 1] === '') body.pop();
    if (end <= start || body.join('').trim() === '') continue;
    cues.push({ start, end, lines: body.map(parseLine) });
  }
  return cues.sort((a, b) => a.start - b.start);
}
