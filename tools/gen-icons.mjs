// 生成插件图标（PNG）。不依赖第三方库：用距离场绘制，4x4 超采样抗锯齿，zlib 压缩编码。
// 用法：node tools/gen-icons.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');

/** 图标变体：默认（灰）与受保护（绿） */
const VARIANTS = [
  { prefix: 'icon', bg: [0x5f, 0x63, 0x68], sizes: [16, 32, 48, 128] },
  { prefix: 'icon-on', bg: [0x18, 0x80, 0x38], sizes: [16, 32] },
];

const WHITE = [255, 255, 255];
const SS = 4; // 每个像素的超采样数（每个方向）

// ---- 形状（坐标归一化到 0..1） ----

function roundedRectSdf(x, y, inset, radius) {
  const cx = Math.abs(x - 0.5) - (0.5 - inset - radius);
  const cy = Math.abs(y - 0.5) - (0.5 - inset - radius);
  const ox = Math.max(cx, 0);
  const oy = Math.max(cy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(cx, cy), 0) - radius;
}

function segmentDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * 返回采样点的颜色，透明时返回 null。
 * 图案：圆角方形底 + 白色时钟（表盘与指针）+ 一道斜杠，表示"抹掉历史"
 */
function sample(x, y, bg) {
  if (roundedRectSdf(x, y, 0.02, 0.2) > 0) return null;

  let color = bg;
  const r = Math.hypot(x - 0.5, y - 0.5);
  if (Math.abs(r - 0.29) < 0.06) color = WHITE; // 表盘
  if (segmentDist(x, y, 0.5, 0.5, 0.5, 0.29) < 0.045) color = WHITE; // 时针（指向 12 点）
  if (segmentDist(x, y, 0.5, 0.5, 0.67, 0.5) < 0.045) color = WHITE; // 分针（指向 3 点）

  // 斜杠从左上到右下，避开位于右上象限的指针
  const slash = segmentDist(x, y, 0.2, 0.2, 0.8, 0.8);
  if (slash < 0.085) color = bg; // 斜杠两侧留出底色间隙
  if (slash < 0.045) color = WHITE;
  return color;
}

function render(size, bg) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size, bg);
          if (!c) continue;
          r += c[0];
          g += c[1];
          b += c[2];
          a += 1;
        }
      }
      const i = (py * size + px) * 4;
      if (a > 0) {
        pixels[i] = Math.round(r / a);
        pixels[i + 1] = Math.round(g / a);
        pixels[i + 2] = Math.round(b / a);
      }
      pixels[i + 3] = Math.round((a / (SS * SS)) * 255);
    }
  }
  return pixels;
}

// ---- PNG 编码 ----

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // 位深
  header[9] = 6; // RGBA
  // 每行开头加滤波类型 0
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const variant of VARIANTS) {
  for (const size of variant.sizes) {
    const file = join(OUT_DIR, `${variant.prefix}-${size}.png`);
    writeFileSync(file, encodePng(size, render(size, variant.bg)));
    console.log(`wrote ${file}`);
  }
}
