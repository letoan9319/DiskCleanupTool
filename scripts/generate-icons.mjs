import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const OUT_DIR = path.resolve("src-tauri/icons");
fs.mkdirSync(OUT_DIR, { recursive: true });

// CRC32 table for PNG chunks
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  const combined = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(combined), 0);
  return Buffer.concat([len, combined, crcBuf]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter None
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function blendPixel(buf, idx, r, g, b, a) {
  if (a <= 0) return;
  const alpha = clamp01(a);
  const inv = 1 - alpha;
  buf[idx] = Math.round(r * alpha + buf[idx] * inv);
  buf[idx + 1] = Math.round(g * alpha + buf[idx + 1] * inv);
  buf[idx + 2] = Math.round(b * alpha + buf[idx + 2] * inv);
  buf[idx + 3] = Math.round(Math.min(255, buf[idx + 3] + alpha * 255 * (1 - buf[idx + 3] / 255)));
}

function sdfRoundRect(px, py, cx, cy, hw, hh, r) {
  const dx = Math.abs(px - cx) - hw + r;
  const dy = Math.abs(py - cy) - hh + r;
  const ox = Math.max(dx, 0);
  const oy = Math.max(dy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(dx, dy), 0) - r;
}

function renderIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const aa = 1.25 / size;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      const idx = (y * size + x) * 4;

      // Outer rounded square container
      const bgDist = sdfRoundRect(u, v, 0.5, 0.5, 0.44, 0.44, 0.14);
      const bgAlpha = clamp01(0.5 - bgDist / aa);
      if (bgAlpha > 0) {
        // Subtle dark slate gradient
        const grad = u * 0.35 + v * 0.65;
        const r = 18 + grad * 14;
        const g = 24 + grad * 18;
        const b = 36 + grad * 26;
        blendPixel(buf, idx, r, g, b, bgAlpha);

        // Subtle inner border
        const borderDist = Math.abs(bgDist + 0.015) - 0.01;
        const borderAlpha = clamp01(0.5 - borderDist / aa) * 0.25 * bgAlpha;
        blendPixel(buf, idx, 148, 163, 184, borderAlpha);
      }

      // Disk platter / ring on top-left-ish or centered descending size bars
      // Draw 3 descending horizontal TreeSize bars (amber -> sky -> emerald) inside a subtle platter frame
      const bar1 = sdfRoundRect(u, v, 0.5, 0.31, 0.28, 0.055, 0.025);
      const bar2 = sdfRoundRect(u, v, 0.42, 0.48, 0.20, 0.055, 0.025);
      const bar3 = sdfRoundRect(u, v, 0.34, 0.65, 0.12, 0.055, 0.025);

      // Background tracks for bars 2 and 3
      const track2 = sdfRoundRect(u, v, 0.5, 0.48, 0.28, 0.055, 0.025);
      const track3 = sdfRoundRect(u, v, 0.5, 0.65, 0.28, 0.055, 0.025);
      blendPixel(buf, idx, 51, 65, 85, clamp01(0.5 - track2 / aa) * 0.55);
      blendPixel(buf, idx, 51, 65, 85, clamp01(0.5 - track3 / aa) * 0.55);

      // Bar 1 (Largest - Amber/Orange warning accent)
      const a1 = clamp01(0.5 - bar1 / aa);
      if (a1 > 0) blendPixel(buf, idx, 245, 158, 11, a1);

      // Bar 2 (Medium - Sky cyan accent)
      const a2 = clamp01(0.5 - bar2 / aa);
      if (a2 > 0) blendPixel(buf, idx, 56, 189, 248, a2);

      // Bar 3 (Smaller - Emerald safe accent)
      const a3 = clamp01(0.5 - bar3 / aa);
      if (a3 > 0) blendPixel(buf, idx, 52, 211, 153, a3);

      // Small circular disk drive badge at bottom-right
      const dRing = Math.hypot(u - 0.69, v - 0.67);
      const ringOuter = clamp01(0.5 - (dRing - 0.105) / aa);
      const ringHole = clamp01(0.5 - (dRing - 0.042) / aa);
      const ringAlpha = Math.max(0, ringOuter - ringHole);
      if (ringAlpha > 0) {
        blendPixel(buf, idx, 226, 232, 240, ringAlpha);
      }
      if (ringHole > 0) {
        blendPixel(buf, idx, 56, 189, 248, ringHole * 0.9);
      }
    }
  }
  return buf;
}

function encodeIco(entries) {
  // Store PNG-encoded images inside ICO container (supported since Windows Vista+)
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = icon
  header.writeUInt16LE(entries.length, 4);

  const dirEntries = [];
  let offset = 6 + entries.length * 16;

  for (const { size, png } of entries) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0; // palette
    entry[3] = 0; // reserved
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bpp
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    dirEntries.push(entry);
    offset += png.length;
  }

  return Buffer.concat([header, ...dirEntries, ...entries.map((e) => e.png)]);
}

const sizes = [16, 32, 48, 64, 128, 256, 512];
const pngBySize = new Map();

for (const s of sizes) {
  const rgba = renderIcon(s);
  pngBySize.set(s, encodePng(s, s, rgba));
}

fs.writeFileSync(path.join(OUT_DIR, "32x32.png"), pngBySize.get(32));
fs.writeFileSync(path.join(OUT_DIR, "128x128.png"), pngBySize.get(128));
fs.writeFileSync(path.join(OUT_DIR, "128x128@2x.png"), pngBySize.get(256));
fs.writeFileSync(path.join(OUT_DIR, "icon.png"), pngBySize.get(512));

const ico = encodeIco([16, 32, 48, 64, 128, 256].map((s) => ({ size: s, png: pngBySize.get(s) })));
fs.writeFileSync(path.join(OUT_DIR, "icon.ico"), ico);

console.log("Generated icons in", OUT_DIR);
