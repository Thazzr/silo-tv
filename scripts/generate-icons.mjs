// Generates the app icons with Node and zlib only. Motif: a light play triangle on a dark
// background; deliberately no Silo logo or wordmark.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const BACKGROUND = [0x10, 0x13, 0x18];
const FOREGROUND = [0xf2, 0xf4, 0xf7];
const SUPERSAMPLE = 4;

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function insideTriangle(px, py, [ax, ay], [bx, by], [cx, cy]) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNegative && hasPositive);
}

/** Returns a square RGB PNG of the given size as a Buffer. */
export function generatePng(size) {
  // The triangle's centroid sits at the icon centre, so it looks centred.
  const triangle = [
    [size * 0.36, size * 0.26],
    [size * 0.36, size * 0.74],
    [size * 0.76, size * 0.5],
  ];
  const rowLength = 1 + size * 3;
  const raw = Buffer.alloc(rowLength * size);
  for (let y = 0; y < size; y++) {
    raw[y * rowLength] = 0; // filter type: none
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const px = x + (sx + 0.5) / SUPERSAMPLE;
          const py = y + (sy + 0.5) / SUPERSAMPLE;
          if (insideTriangle(px, py, ...triangle)) hits++;
        }
      }
      const coverage = hits / (SUPERSAMPLE * SUPERSAMPLE);
      for (let channel = 0; channel < 3; channel++) {
        raw[y * rowLength + 1 + x * 3 + channel] = Math.round(
          BACKGROUND[channel] * (1 - coverage) + FOREGROUND[channel] * coverage,
        );
      }
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export const ICONS = [
  { file: 'icon.png', size: 80 },
  { file: 'largeIcon.png', size: 130 },
];

export function writeIcons(directory) {
  mkdirSync(directory, { recursive: true });
  for (const { file, size } of ICONS) {
    writeFileSync(resolve(directory, file), generatePng(size));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');
  writeIcons(publicDir);
  console.log(`Icons written to ${publicDir}`);
}
