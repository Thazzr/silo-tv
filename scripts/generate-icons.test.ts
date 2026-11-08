import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { generatePng, writeIcons } from './generate-icons.mjs';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

function dimensions(png: Buffer) {
  expect(png.subarray(0, 8).equals(SIGNATURE)).toBe(true);
  expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

describe('generate-icons', () => {
  it('writes icon.png at 80x80 and largeIcon.png at 130x130', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'silo-icons-'));
    writeIcons(tempDir);
    expect(dimensions(readFileSync(join(tempDir, 'icon.png')))).toEqual({ width: 80, height: 80 });
    expect(dimensions(readFileSync(join(tempDir, 'largeIcon.png')))).toEqual({
      width: 130,
      height: 130,
    });
  });

  it('draws a light triangle in the middle of a dark background', () => {
    const png: Buffer = generatePng(80);
    // IDAT starts after signature (8) + IHDR chunk (25) + length/type (8).
    const idatLength = png.readUInt32BE(33);
    const raw = inflateSync(png.subarray(41, 41 + idatLength));
    const pixel = (x: number, y: number) => {
      const offset = y * (1 + 80 * 3) + 1 + x * 3;
      return [raw[offset], raw[offset + 1], raw[offset + 2]];
    };
    expect(pixel(1, 1)).toEqual([0x10, 0x13, 0x18]);
    expect(pixel(40, 40)).toEqual([0xf2, 0xf4, 0xf7]);
  });
});
