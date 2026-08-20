// 应用图标生成工具（纯 Node，零外部依赖）。
//
// 功能：
//   读取任意 PNG 源图，缩放为 Tauri 所需的全部图标尺寸，
//   并生成 Windows 可用的 .ico（内嵌 256×256 PNG）。
//
// 用法：
//   npm run make:icons                         # 使用默认源图
//   npm run make:icons -- "路径/源图.png"       # 指定源图
//
// 默认源图：项目根目录的 icon.png
//
// 输出：src-tauri/icons/
//   32x32.png
//   128x128.png
//   128x128@2x.png   (256×256)
//   icon.ico         (256×256 PNG 编码)
//
// 注意：
//   - 仅支持 8-bit RGBA 的 PNG（大多数设计软件/截图导出均为该格式）。
//   - 缩放采用最近邻算法，对扁平/几何风格图标效果好；
//     若源图含精细渐变，可后续替换为高质量插值（见文档）。

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

if (!fs.existsSync(src)) {
  console.error(`\n✗ 源图不存在：${src}`);
  console.error("  用法：npm run make:icons -- \"路径/源图.png\"\n");
  process.exit(1);
}

// ---------- PNG 解码 ----------
// 仅支持 8-bit、color type 2(RGB) 与 6(RGBA)。
function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error("不是有效的 PNG 文件");
  }
  let off = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    off += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`不支持的 PNG 格式：bitDepth=${bitDepth} colorType=${colorType}（仅支持 8-bit RGB/RGBA）`);
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));

  // 解析每行 filter，逐行还原像素。
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
          const pa = Math.abs(b - c);
          const pb = Math.abs(a - c);
          const pc = Math.abs(a + b - 2 * c);
          const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          r = v + pred;
          break;
        }
        default: throw new Error(`不支持的 filter 类型：${filter}`);
      }
      pixels[y * stride + x] = r & 0xff;
    }
  }

  // 统一为 RGBA。
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = pixels[i * channels];
    rgba[i * 4 + 1] = pixels[i * channels + 1];
    rgba[i * 4 + 2] = pixels[i * channels + 2];
    rgba[i * 4 + 3] = channels === 4 ? pixels[i * channels + 3] : 255;
  }
  return { width, height, rgba };
}

// ---------- 最近邻缩放 ----------
function scaleImage(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor((y * sh) / dh));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.floor((x * sw) / dw));
      const si = (sy * sw + sx) * 4;
      const di = (y * dw + x) * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = src[si + 3];
    }
  }
  return out;
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
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc((size * 4 + 1) * size);
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      raw[p++] = rgba[(y * size + x) * 4];
      raw[p++] = rgba[(y * size + x) * 4 + 1];
      raw[p++] = rgba[(y * size + x) * 4 + 2];
      raw[p++] = rgba[(y * size + x) * 4 + 3];
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- ICO 编码（内嵌 256×256 PNG） ----------
function encodeIco(png256) {
  const ico = Buffer.alloc(6 + 16 + png256.length);
  ico.writeUInt16LE(0, 0); // reserved
  ico.writeUInt16LE(1, 2); // type = icon
  ico.writeUInt16LE(1, 4); // image count
  let o = 6;
  ico.writeUInt8(0, o);       // width  (0 => 256)
  ico.writeUInt8(0, o + 1);   // height
  ico.writeUInt8(0, o + 2);   // colors
  ico.writeUInt8(0, o + 3);   // reserved
  ico.writeUInt16LE(1, o + 4); // color planes
  ico.writeUInt16LE(32, o + 6); // bit count
  ico.writeUInt32LE(png256.length, o + 8);  // size
  ico.writeUInt32LE(22, o + 12);            // offset
  png256.copy(ico, 22);
  return ico;
}

// ---------- 主流程 ----------
console.log(`源图：${src}`);
const { width: sw, height: sh, rgba } = decodePng(fs.readFileSync(src));
console.log(`  尺寸：${sw}×${sh}`);

const targets = [
  [32, "32x32.png"],
  [128, "128x128.png"],
  [256, "128x128@2x.png"],
];

for (const [s, name] of targets) {
  const scaled = scaleImage(rgba, sw, sh, s, s);
  fs.writeFileSync(path.join(outDir, name), encodePng(scaled, s));
  console.log(`  ✓ 生成 ${name}`);
}

const png256 = encodePng(scaleImage(rgba, sw, sh, 256, 256), 256);
fs.writeFileSync(path.join(outDir, "icon.ico"), encodeIco(png256));
console.log("  ✓ 生成 icon.ico");

// Tauri 规范要求的源图标（用于生成 Square* 系列与嵌入 exe）
fs.writeFileSync(path.join(outDir, "icon.png"), encodePng(scaleImage(rgba, sw, sh, 512, 512), 512));
console.log("  ✓ 生成 icon.png (512x512)");

console.log(`\n完成。图标输出目录：${outDir}`);
