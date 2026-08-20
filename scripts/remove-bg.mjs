// 图标背景透明化工具（纯 Node，零外部依赖）。
//
// 功能：
//   读取 src-tauri/icons/ 下的图标，将「从四角连通的近白色区域」设为透明，
//   实现透明底图标。只抠外围背景，不会误删浅色主体（主体不接近纯白）。
//
// 用法：
//   npm run remove:bg
//
// 处理对象：
//   32x32.png / 128x128.png / 128x128@2x.png / icon.png / icon.ico(内嵌 256 PNG)

import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, "../src-tauri/icons");

// 近白容差：RGB 三个分量都 >= 255 - T 视为背景白。
// 主体(浅绿) R≈171，不会被误判；边缘抗锯齿的浅白会被抠掉。
const T = 30;

// ---------- PNG 解码 ----------
function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error("不是有效的 PNG 文件");
  }
  let off = 8, width = 0, height = 0, colorType = 0;
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

// ---------- 四角泛洪抠背景（近白 -> 透明） ----------
function makeTransparentBG({ width, height, rgba }) {
  const nearWhite = (i) =>
    rgba[i] >= 255 - T && rgba[i + 1] >= 255 - T && rgba[i + 2] >= 255 - T;
  const seen = new Uint8Array(width * height);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = y * width + x;
    if (seen[i]) return;
    if (!nearWhite(i * 4)) return;
    seen[i] = 1;
    stack.push(i);
  };
  push(0, 0);
  push(width - 1, 0);
  push(0, height - 1);
  push(width - 1, height - 1);
  while (stack.length) {
    const i = stack.pop();
    const x = i % width, y = (i / width) | 0;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
  let cnt = 0;
  for (let i = 0; i < width * height; i++) {
    if (seen[i]) {
      rgba[i * 4 + 3] = 0; // alpha = 透明
      cnt++;
    }
  }
  return cnt;
}

// ---------- 边缘羽化抗锯齿 ----------
// 抠白后透明边缘是硬锯齿，这里把"紧邻实心像素的透明像素"变成半透明软边，
// 颜色取相邻主体色（避免透出白雾），形成 1~2px 平滑过渡。
function antiAlias(rgba, width, height) {
  for (let pass = 0; pass < 2; pass++) {
    const cp = Buffer.from(rgba);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (cp[i + 3] === 255) continue; // 仅处理非实心像素
        let on = 0, rs = 0, gs = 0, bs = 0;
        let anyA = 0, ar = 0, ag = 0, ab = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const ni = (ny * width + nx) * 4;
            if (cp[ni + 3] === 255) { on++; rs += cp[ni]; gs += cp[ni + 1]; bs += cp[ni + 2]; }
            else if (cp[ni + 3] > 0) { anyA++; ar += cp[ni]; ag += cp[ni + 1]; ab += cp[ni + 2]; }
          }
        }
        if (on > 0) {
          rgba[i] = rs / on; rgba[i + 1] = gs / on; rgba[i + 2] = bs / on;
          rgba[i + 3] = pass === 0 ? 200 : 110;
        } else if (anyA > 0 && pass === 1) {
          rgba[i] = ar / anyA; rgba[i + 1] = ag / anyA; rgba[i + 2] = ab / anyA;
          rgba[i + 3] = 60;
        }
      }
    }
  }
}

// ---------- ICO 解码 / 再编码 ----------
function decodeIco(buf) {
  // 仅支持内嵌 PNG 的单图 ICO（本工具生成的格式）。
  if (buf.readUInt16LE(2) !== 1) throw new Error("ICO 类型不支持");
  const count = buf.readUInt16LE(4);
  const entries = [];
  let o = 6;
  for (let i = 0; i < count; i++) {
    const w = buf[o] === 0 ? 256 : buf[o];
    const h = buf[o + 1] === 0 ? 256 : buf[o + 1];
    const size = buf.readUInt32LE(o + 8);
    const offset = buf.readUInt32LE(o + 12);
    entries.push({ w, h, size, offset, data: buf.subarray(offset, offset + size) });
    o += 16;
  }
  return entries;
}
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
const pngFiles = ["32x32.png", "128x128.png", "128x128@2x.png", "icon.png"];
for (const name of pngFiles) {
  const fp = path.join(outDir, name);
  if (!fs.existsSync(fp)) continue;
  const img = decodePng(fs.readFileSync(fp));
  const cnt = makeTransparentBG(img);
  antiAlias(img.rgba, img.width, img.height);
  fs.writeFileSync(fp, encodePng(img.rgba, img.width));
  console.log(`  ✓ ${name}：抠除背景像素 ${cnt}`);
}

const icoPath = path.join(outDir, "icon.ico");
if (fs.existsSync(icoPath)) {
  const entries = decodeIco(fs.readFileSync(icoPath));
  const e = entries[0];
  if (e.data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    const img = decodePng(e.data);
    const cnt = makeTransparentBG(img);
    antiAlias(img.rgba, img.width, img.height);
    const newPng = encodePng(img.rgba, img.width);
    fs.writeFileSync(icoPath, encodeIco(newPng));
    console.log(`  ✓ icon.ico：抠除背景像素 ${cnt}`);
  } else {
    console.log("  ! icon.ico 内嵌非 PNG，跳过");
  }
}

console.log(`\n完成。图标输出目录：${outDir}`);
