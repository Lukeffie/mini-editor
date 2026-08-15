// 生成 Tauri 所需的图标（纯 Node，无需外部工具）。
// 用法：npm run icons  （在 mini-editor 根目录执行）
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, "../src-tauri/icons");
fs.mkdirSync(outDir, { recursive: true });

const COLOR = [45, 108, 223, 255]; // #2D6CDF

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

function makePng(size) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc((size * 4 + 1) * size);
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      raw[p++] = COLOR[0];
      raw[p++] = COLOR[1];
      raw[p++] = COLOR[2];
      raw[p++] = COLOR[3];
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

const targets = [
  [32, "32x32.png"],
  [128, "128x128.png"],
  [256, "128x128@2x.png"],
];
for (const [s, name] of targets) {
  fs.writeFileSync(path.join(outDir, name), makePng(s));
  console.log("wrote", name);
}

// ICO：内嵌一张 256x256 的 PNG（Windows 支持 PNG 格式 ICO）
const png256 = makePng(256);
const ico = Buffer.alloc(6 + 16 + png256.length);
ico.writeUInt16LE(0, 0); // reserved
ico.writeUInt16LE(1, 2); // type = icon
ico.writeUInt16LE(1, 4); // image count
let o = 6;
ico.writeUInt8(0, o); // width  (0 => 256)
ico.writeUInt8(0, o + 1); // height
ico.writeUInt8(0, o + 2); // colors
ico.writeUInt8(0, o + 3); // reserved
ico.writeUInt16LE(1, o + 4); // color planes
ico.writeUInt16LE(32, o + 6); // bit count
ico.writeUInt32LE(png256.length, o + 8); // size
ico.writeUInt32LE(22, o + 12); // offset
png256.copy(ico, 22);
fs.writeFileSync(path.join(outDir, "icon.ico"), ico);
console.log("wrote icon.ico");
