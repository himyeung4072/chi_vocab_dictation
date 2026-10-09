'use strict';

/* 生成 PWA 圖示（icons/*.png）：橙色底 + 白色爪印。純 Node，唔使任何套件。
   用法：node tools/make-icons.js
   - icon-192.png／icon-512.png：圓角、透明角（purpose: any）
   - icon-maskable-512.png：全幅底色，爪印縮細留安全區（purpose: maskable）
   - apple-touch-icon.png（180）：全幅底色，iOS 自己裁圓角 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'icons');
const SS = 3;   // 每邊超取樣倍數（抗鋸齒）

/* 爪印：一個大掌墊 + 四粒趾，座標係 0–1 嘅單位正方形，[cx, cy, rx, ry] */
const PAW = [
  [0.50, 0.64, 0.225, 0.175],
  [0.22, 0.46, 0.075, 0.10],
  [0.40, 0.30, 0.082, 0.108],
  [0.60, 0.30, 0.082, 0.108],
  [0.78, 0.46, 0.075, 0.10]
];

function inEllipse(x, y, e, scale, dx, dy) {
  // 以 (0.5, 0.5) 為中心縮放，再平移 (dx, dy)
  const cx = 0.5 + (e[0] - 0.5) * scale + dx;
  const cy = 0.5 + (e[1] - 0.5) * scale + dy;
  const nx = (x - cx) / (e[2] * scale);
  const ny = (y - cy) / (e[3] * scale);
  return nx * nx + ny * ny <= 1;
}

function inPaw(x, y, scale, dx, dy) {
  return PAW.some(function (e) { return inEllipse(x, y, e, scale, dx, dy); });
}

function inRoundedSquare(x, y, r) {
  const qx = Math.abs(x - 0.5) - (0.5 - r);
  const qy = Math.abs(y - 0.5) - (0.5 - r);
  if (qx <= 0 || qy <= 0) return Math.abs(x - 0.5) <= 0.5 && Math.abs(y - 0.5) <= 0.5;
  return qx * qx + qy * qy <= r * r;
}

function lerp(a, b, t) { return a + (b - a) * t; }

/* 一個子像素嘅顏色 [r, g, b, a]（a 0–1） */
function sample(x, y, o) {
  if (o.round && !inRoundedSquare(x, y, 0.22)) return [0, 0, 0, 0];
  // 底色：上 #FF9A55 → 下 #E8691A
  let c = [lerp(255, 232, y), lerp(154, 105, y), lerp(85, 26, y)];
  if (inPaw(x, y, o.scale, 0.018 * o.scale, 0.024 * o.scale)) c = [c[0] * 0.62, c[1] * 0.5, c[2] * 0.45];   // 影
  if (inPaw(x, y, o.scale, 0, 0)) c = [255, 255, 255];
  return [c[0], c[1], c[2], 1];
}

function render(size, o) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;   // filter: none
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const s = sample((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size, o);
          r += s[0] * s[3]; g += s[1] * s[3]; b += s[2] * s[3]; a += s[3];
        }
      }
      const n = SS * SS;
      const i = py * (size * 4 + 1) + 1 + px * 4;
      raw[i] = a ? Math.round(r / a) : 0;
      raw[i + 1] = a ? Math.round(g / a) : 0;
      raw[i + 2] = a ? Math.round(b / a) : 0;
      raw[i + 3] = Math.round((a / n) * 255);
    }
  }
  return raw;
}

const CRC_TABLE = (function () {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t.push(c >>> 0);
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, o) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // 位深
  ihdr[9] = 6;    // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(render(size, o), { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

fs.mkdirSync(OUT, { recursive: true });
[
  ['icon-192.png', 192, { round: true, scale: 1 }],
  ['icon-512.png', 512, { round: true, scale: 1 }],
  ['icon-maskable-512.png', 512, { round: false, scale: 0.72 }],   // 安全區：中間 80% 圓形內
  ['apple-touch-icon.png', 180, { round: false, scale: 0.86 }]
].forEach(function (x) {
  const buf = png(x[1], x[2]);
  fs.writeFileSync(path.join(OUT, x[0]), buf);
  console.log(x[0], x[1] + 'x' + x[1], buf.length + ' bytes');
});
