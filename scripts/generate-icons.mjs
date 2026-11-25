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
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
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

// Crisp 16x16 pixel-art drive silhouette matching the Retro-Sky UI
const sprite = [
  "................",
  ".....########...",
  "....#wwwwwwwb#..",
  "....#wllllllb#..",
  "...#wlllllllb#..",
  "...#wlllllllb#..",
  "..#wlllllllb##..",
  "..#wwwwwwwwww#..",
  ".##############.",
  ".#bbbbbbbbbbbb#.",
  ".#b####bbggbgb#.",
  ".#bbbbbbbbbbbb#.",
  ".##############.",
  "..##........##..",
  "................",
  "................",
];

const palette = {
  "#": [27, 57, 106],
  w: [231, 249, 255],
  l: [143, 208, 251],
  b: [74, 130, 206],
  g: [139, 255, 215],
};

function renderIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const sy = Math.min(15, Math.floor((y * 16) / size));
    for (let x = 0; x < size; x++) {
      const sx = Math.min(15, Math.floor((x * 16) / size));
      const color = palette[sprite[sy][sx]];
      if (color) {
        const off = (y * size + x) * 4;
        pixels[off] = color[0];
        pixels[off + 1] = color[1];
        pixels[off + 2] = color[2];
        pixels[off + 3] = 255;
      }
    }
  }
  return pixels;
}

// Standard Win32 32-bit BGRA DIB (BITMAPINFOHEADER + bottom-up XOR + 1-bit AND mask)
function encodeDib(size, rgba) {
  const xorSize = size * size * 4;
  const andRowStride = Math.ceil(size / 32) * 4;
  const andSize = andRowStride * size;

  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); // biSize
  header.writeInt32LE(size, 4); // biWidth
  header.writeInt32LE(size * 2, 8); // biHeight = 2 * height (XOR + AND)
  header.writeUInt16LE(1, 12); // biPlanes
  header.writeUInt16LE(32, 14); // biBitCount
  header.writeUInt32LE(0, 16); // BI_RGB
  header.writeUInt32LE(xorSize + andSize, 20); // biSizeImage

  const xorBuf = Buffer.alloc(xorSize);
  const andBuf = Buffer.alloc(andSize, 0);

  for (let y = 0; y < size; y++) {
    const srcRow = size - 1 - y; // bottom-up
    for (let x = 0; x < size; x++) {
      const srcOff = (srcRow * size + x) * 4;
      const dstOff = (y * size + x) * 4;
      const r = rgba[srcOff];
      const g = rgba[srcOff + 1];
      const b = rgba[srcOff + 2];
      const a = rgba[srcOff + 3];

      // BGRA order
      xorBuf[dstOff] = b;
      xorBuf[dstOff + 1] = g;
      xorBuf[dstOff + 2] = r;
      xorBuf[dstOff + 3] = a;

      if (a === 0) {
        const byteIdx = y * andRowStride + (x >> 3);
        andBuf[byteIdx] |= 0x80 >> (x & 7);
      }
    }
  }

  return Buffer.concat([header, xorBuf, andBuf]);
}

function encodeIco(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = icon
  header.writeUInt16LE(frames.length, 4);

  const dirEntries = [];
  let offset = 6 + frames.length * 16;

  for (const { size, payload } of frames) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // 32 bpp
    entry.writeUInt32LE(payload.length, 8);
    entry.writeUInt32LE(offset, 12);
    dirEntries.push(entry);
    offset += payload.length;
  }

  return Buffer.concat([header, ...dirEntries, ...frames.map((f) => f.payload)]);
}

const allSizes = [16, 24, 32, 48, 64, 128, 256, 512];
const rgbaBySize = new Map();
const pngBySize = new Map();

for (const s of allSizes) {
  const rgba = renderIcon(s);
  rgbaBySize.set(s, rgba);
  pngBySize.set(s, encodePng(s, s, rgba));
}

fs.writeFileSync(path.join(OUT_DIR, "32x32.png"), pngBySize.get(32));
fs.writeFileSync(path.join(OUT_DIR, "64x64.png"), pngBySize.get(64));
fs.writeFileSync(path.join(OUT_DIR, "128x128.png"), pngBySize.get(128));
fs.writeFileSync(path.join(OUT_DIR, "128x128@2x.png"), pngBySize.get(256));
fs.writeFileSync(path.join(OUT_DIR, "icon.png"), pngBySize.get(512));

// Use standard Win32 DIB for < 256px (guaranteed compatibility with windres, NSIS, Explorer & Taskbar)
// and PNG for 256x256 high-DPI frame
const icoFrames = [16, 24, 32, 48, 64, 128, 256].map((s) => ({
  size: s,
  payload: s >= 256 ? pngBySize.get(s) : encodeDib(s, rgbaBySize.get(s)),
}));

fs.writeFileSync(path.join(OUT_DIR, "icon.ico"), encodeIco(icoFrames));

console.log("Generated synced DIB+PNG icons in", OUT_DIR);
