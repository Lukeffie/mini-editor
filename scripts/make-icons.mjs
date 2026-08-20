// 应用图标生成工具（纯 Node，零外部依赖）。
//
// 设计原则（纯几何，不靠颜色判断背景）：
//   1. 图形四边顶满画布；
//   2. 输出 1:1 正方形；
//   3. 源图非正方时居中裁切四周；
//   4. 按固定比例做圆角，圆角外为透明底；
//   5. 不使用任何颜色块匹配来判定背景/前景。
//
// 用法：
//   npm run make:icons                         # 使用默认源图
//   npm run make:icons -- "路径/源图.png"       # 指定源图
//
// 默认源图：项目根目录的 icon.png
// 输出：src-tauri/icons/

import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, "../src-tauri/icons");
fs.mkdirSync(outDir, { recursive: true });

const DEFAULT_SRC = path.resolve(__dirname, "../icon.png");
const srcArg = process.argv[2];
const src = srcArg ? path.resolve(srcArg) : DEFAULT_SRC;

// 圆角比例（固定）：圆角半径 = 尺寸 * RATIO。改这里即可调整圆角大小。
const RATIO = 0.22;

if (!fs.existsSync(src)) {
  console.error(`\n✗ 源图不存在：${src}`);
  console.error("  用法：npm run make:icons -- \"路径/源图.png\"\n");
  process.exit(1);
}

// ---------- PNG 解码 ----------
function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error("不是有效的 PNG 文件");
  }
  let off = 8;
  let width = 0, height = 0, colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    off += 12 + len;
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    for (let x = 0; x < stride; x++) {
      const v = raw[p++];
      const a = x >= channels ? pixels[y * stride + x - channels] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0;
      let r;
      switch (filter) {
        case 0: r = v; break;
        case 1: r = v + a; break;
        case 2: r = v + b; break;
        case 3: r = v + ((a + b) >> 1); break;
        case 4: {
          const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
          r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`不支持的 filter 类型：${filter}`);
      }
      pixels[y * stride + x] = r & 0xff;
    }
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = pixels[i * channels];
    rgba[i * 4 + 1] = pixels[i * channels + 1];
    rgba[i * 4 + 2] = pixels[i * channels + 2];
    rgba[i * 4 + 3] = channels === 4 ? pixels[i * channels + 3] : 255;
  }
  return { width, height, rgba };
}

// ---------- 按内容边界裁剪（裁掉四周白线，让图形四边顶满） ----------
// 说明：白线是不透明白色，纯坐标几何无法区分它与图形，
// 因此这一步用颜色确定图形真实边界用于"裁切边距"，不做背景透明判定。
function cropToContent(rgba, w, h) {
  const T = 30; // 近白阈值，仅用于定位图形边界
  const nearWhite = (i) => rgba[i] >= 255 - T && rgba[i + 1] >= 255 - T && rgba[i + 2] >= 255 - T;
  let minx = w, maxx = -1, miny = h, maxy = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (!nearWhite(i)) {
        if (x < minx) minx = x;
        if (x > maxx) maxx = x;
        if (y < miny) miny = y;
        if (y > maxy) maxy = y;
      }
    }
  }
  if (maxx < 0) return { rgba, width: w, height: h }; // 全是白，不裁剪
  // 各留 1px 余量，避免裁掉抗锯齿边缘
  minx = Math.max(0, minx - 1);
  miny = Math.max(0, miny - 1);
  maxx = Math.min(w - 1, maxx + 1);
  maxy = Math.min(h - 1, maxy + 1);
  const cw = maxx - minx + 1, ch = maxy - miny + 1;
  const out = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const si = ((y + miny) * w + (x + minx)) * 4;
      const di = (y * cw + x) * 4;
      out[di] = rgba[si];
      out[di + 1] = rgba[si + 1];
      out[di + 2] = rgba[si + 2];
      out[di + 3] = rgba[si + 3];
    }
  }
  return { rgba: out, width: cw, height: ch };
}

// ---------- 双线性插值缩放（颜色平滑，消除块状噪点/污渍） ----------
function scaleImage(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const fy = ((y + 0.5) / dh) * sh - 0.5;
    const y0 = Math.floor(fy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = ((x + 0.5) / dw) * sw - 0.5;
      const x0 = Math.floor(fx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const tx = fx - x0;
      const w00 = (1 - tx) * (1 - ty);
      const w10 = tx * (1 - ty);
      const w01 = (1 - tx) * ty;
      const w11 = tx * ty;
      const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
      const di = (y * dw + x) * 4;
      out[di]     = src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11;
      out[di + 1] = src[i00 + 1] * w00 + src[i10 + 1] * w10 + src[i01 + 1] * w01 + src[i11 + 1] * w11;
      out[di + 2] = src[i00 + 2] * w00 + src[i10 + 2] * w10 + src[i01 + 2] * w01 + src[i11 + 2] * w11;
      out[di + 3] = src[i00 + 3] * w00 + src[i10 + 3] * w10 + src[i01 + 3] * w01 + src[i11 + 3] * w11;
    }
  }
  return out;
}

// ---------- 固定比例圆角遮罩（纯几何，规则 4） ----------
function roundMask(rgba, size, ratio) {
  const r = Math.max(1, Math.round(size * ratio));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      let outside = false;
      if (x < r && y < r) {
        const dx = r - x, dy = r - y;
        if (dx * dx + dy * dy > r * r) outside = true;
      } else if (x >= size - r && y < r) {
        const dx = x - (size - r), dy = r - y;
        if (dx * dx + dy * dy > r * r) outside = true;
      } else if (x < r && y >= size - r) {
        const dx = r - x, dy = y - (size - r);
        if (dx * dx + dy * dy > r * r) outside = true;
      } else if (x >= size - r && y >= size - r) {
        const dx = x - (size - r), dy = y - (size - r);
        if (dx * dx + dy * dy > r * r) outside = true;
      }
      if (outside) rgba[i + 3] = 0; // 圆角外 -> 透明
    }
  }
}

// ---------- 圆角边缘 1px 羽化（几何，取邻域主体色，不判背景颜色） ----------
function feather(rgba, size) {
  const cp = Buffer.from(rgba);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (cp[i + 3] !== 0) continue; // 仅处理透明像素
      let on = 0, rs = 0, gs = 0, bs = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const ni = (ny * size + nx) * 4;
          if (cp[ni + 3] !== 0) { on++; rs += cp[ni]; gs += cp[ni + 1]; bs += cp[ni + 2]; }
        }
      }
      if (on > 0) {
        rgba[i] = rs / on; rgba[i + 1] = gs / on; rgba[i + 2] = bs / on;
        rgba[i + 3] = 128;
      }
    }
  }
}

// ---------- PNG 编码 ----------
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePng(rgba, size) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0;
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      raw[p++] = rgba[i];
      raw[p++] = rgba[i + 1];
      raw[p++] = rgba[i + 2];
      raw[p++] = rgba[i + 3];
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// ---------- ICO 编码（内嵌 256×256 PNG） ----------
function encodeIco(png256) {
  const ico = Buffer.alloc(6 + 16 + png256.length);
  ico.writeUInt16LE(0, 0);
  ico.writeUInt16LE(1, 2);
  ico.writeUInt16LE(1, 4);
  let o = 6;
  ico.writeUInt8(0, o);
  ico.writeUInt8(0, o + 1);
  ico.writeUInt8(0, o + 2);
  ico.writeUInt8(0, o + 3);
  ico.writeUInt16LE(1, o + 4);
  ico.writeUInt16LE(32, o + 6);
  ico.writeUInt32LE(png256.length, o + 8);
  ico.writeUInt32LE(22, o + 12);
  png256.copy(ico, 22);
  return ico;
}

// ---------- 主流程 ----------
console.log(`源图：${src}`);
const decoded = decodePng(fs.readFileSync(src));
console.log(`  原始尺寸：${decoded.width}×${decoded.height}`);
const content = cropToContent(decoded.rgba, decoded.width, decoded.height);
const cw = content.width, ch = content.height;
console.log(`  内容裁剪后：${cw}×${ch}（圆角比例 ${RATIO}）`);

function build(size, name) {
  const img = scaleImage(content.rgba, cw, ch, size, size);
  roundMask(img, size, RATIO);
  feather(img, size);
  fs.writeFileSync(path.join(outDir, name), encodePng(img, size));
  console.log(`  ✓ 生成 ${name} (${size}×${size})`);
}

build(32, "32x32.png");
build(128, "128x128.png");
build(256, "128x128@2x.png");

const png256 = scaleImage(content.rgba, cw, ch, 256, 256);
roundMask(png256, 256, RATIO);
feather(png256, 256);
fs.writeFileSync(path.join(outDir, "icon.ico"), encodeIco(encodePng(png256, 256)));
console.log("  ✓ 生成 icon.ico");

build(512, "icon.png");

console.log(`\n完成。图标输出目录：${outDir}`);
