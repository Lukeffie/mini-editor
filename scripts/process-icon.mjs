// 处理 icon.png：识别圆角矩形图标区域，去除设计辅助线，圆角外变透明，图标撑满整张图。
// 纯 Node，零依赖。用法：node scripts/process-icon.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const src = path.join(root, "icon.png");
const dst = src; // 覆盖原文件

if (!fs.existsSync(src)) {
  console.error("源图不存在:", src);
  process.exit(1);
}

// ---------- PNG 解码（8-bit RGB/RGBA） ----------
function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    throw new Error("不是有效 PNG");
  let off = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
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
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6))
    throw new Error(`不支持的 PNG 格式 bit=${bitDepth} ct=${colorType}`);
  const ch = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const px = Buffer.alloc(stride * height);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[p++];
    for (let x = 0; x < stride; x++) {
      const v = raw[p++];
      const a = x >= ch ? px[y * stride + x - ch] : 0;
      const bb = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= ch && y > 0 ? px[(y - 1) * stride + x - ch] : 0;
      let r;
      switch (f) {
        case 0: r = v; break;
        case 1: r = v + a; break;
        case 2: r = v + bb; break;
        case 3: r = v + ((a + bb) >> 1); break;
        case 4: {
          const pa = Math.abs(bb - c), pb = Math.abs(a - c), pc = Math.abs(a + bb - 2 * c);
          r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? bb : c);
          break;
        }
        default: r = v;
      }
      px[y * stride + x] = r & 0xff;
    }
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = px[i * ch];
    rgba[i * 4 + 1] = px[i * ch + 1];
    rgba[i * 4 + 2] = px[i * ch + 2];
    rgba[i * 4 + 3] = ch === 4 ? px[i * ch + 3] : 255;
  }
  return { width, height, rgba };
}

// ---------- PNG 编码 ----------
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePng(rgba, size) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0;
    for (let x = 0; x < size; x++) {
      raw[p++] = rgba[(y * size + x) * 4];
      raw[p++] = rgba[(y * size + x) * 4 + 1];
      raw[p++] = rgba[(y * size + x) * 4 + 2];
      raw[p++] = rgba[(y * size + x) * 4 + 3];
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// ---------- 工具函数 ----------
function setPixel(buf, W, x, y, r, g, b, a) {
  const i = (y * W + x) * 4;
  buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
}

// ---------- 直线辅助线检测与修复 ----------
// 设计稿导出时常携带参考线/切片线（1px 宽，颜色与背景略有差异）。
// 这里检测：某像素与其上下/左右邻域明显不同，但上下或左右两侧彼此相似，且延伸足够长。
function removeGuideLines(rgba, W, H) {
  const px = Buffer.from(rgba);

  // 竖线检测
  for (let y = 2; y < H - 2; y++) {
    for (let x = 2; x < W - 2; ) {
      const i = (y * W + x) * 4;
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      const left = [rgba[i - 4], rgba[i - 3], rgba[i - 2]];
      const right = [rgba[i + 4], rgba[i + 5], rgba[i + 6]];
      const dLeft = Math.abs(r - left[0]) + Math.abs(g - left[1]) + Math.abs(b - left[2]);
      const dRight = Math.abs(r - right[0]) + Math.abs(g - right[1]) + Math.abs(b - right[2]);
      const sideSim = Math.abs(left[0] - right[0]) + Math.abs(left[1] - right[1]) + Math.abs(left[2] - right[2]);
      // 线通常偏灰/偏暗，比两侧明显暗或明显亮
      const lineDark = (r + g + b) / 3 < (left[0] + left[1] + left[2] + right[0] + right[1] + right[2]) / 6;
      if (dLeft > 15 && dRight > 15 && sideSim < 60 && lineDark) {
        let len = 1;
        for (let yy = y + 1; yy < H - 2 && len < 400; yy++) {
          const ii = (yy * W + x) * 4;
          const lr = rgba[ii], lg = rgba[ii + 1], lb = rgba[ii + 2];
          const lleft = [rgba[ii - 4], rgba[ii - 3], rgba[ii - 2]];
          const lright = [rgba[ii + 4], rgba[ii + 5], rgba[ii + 6]];
          if (Math.abs(lr - lleft[0]) + Math.abs(lg - lleft[1]) + Math.abs(lb - lleft[2]) > 15 &&
              Math.abs(lr - lright[0]) + Math.abs(lg - lright[1]) + Math.abs(lb - lright[2]) > 15) len++;
          else break;
        }
        if (len > 80) {
          for (let yy = y; yy < y + len; yy++) {
            const leftIdx = (yy * W + (x - 1)) * 4;
            const rightIdx = (yy * W + (x + 1)) * 4;
            setPixel(px, W, x, yy,
              (rgba[leftIdx] + rgba[rightIdx]) >> 1,
              (rgba[leftIdx + 1] + rgba[rightIdx + 1]) >> 1,
              (rgba[leftIdx + 2] + rgba[rightIdx + 2]) >> 1,
              255);
          }
          x++;
          continue;
        }
      }
      x++;
    }
  }

  // 横线检测
  for (let x = 2; x < W - 2; x++) {
    for (let y = 2; y < H - 2; ) {
      const i = (y * W + x) * 4;
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      const top = [rgba[i - W * 4], rgba[i - W * 4 + 1], rgba[i - W * 4 + 2]];
      const bottom = [rgba[i + W * 4], rgba[i + W * 4 + 1], rgba[i + W * 4 + 2]];
      const dTop = Math.abs(r - top[0]) + Math.abs(g - top[1]) + Math.abs(b - top[2]);
      const dBottom = Math.abs(r - bottom[0]) + Math.abs(g - bottom[1]) + Math.abs(b - bottom[2]);
      const sideSim = Math.abs(top[0] - bottom[0]) + Math.abs(top[1] - bottom[1]) + Math.abs(top[2] - bottom[2]);
      const lineDark = (r + g + b) / 3 < (top[0] + top[1] + top[2] + bottom[0] + bottom[1] + bottom[2]) / 6;
      if (dTop > 15 && dBottom > 15 && sideSim < 60 && lineDark) {
        let len = 1;
        for (let xx = x + 1; xx < W - 2 && len < 400; xx++) {
          const ii = (y * W + xx) * 4;
          const lr = rgba[ii], lg = rgba[ii + 1], lb = rgba[ii + 2];
          const t = [rgba[ii - W * 4], rgba[ii - W * 4 + 1], rgba[ii - W * 4 + 2]];
          const bot = [rgba[ii + W * 4], rgba[ii + W * 4 + 1], rgba[ii + W * 4 + 2]];
          if (Math.abs(lr - t[0]) + Math.abs(lg - t[1]) + Math.abs(lb - t[2]) > 15 &&
              Math.abs(lr - bot[0]) + Math.abs(lg - bot[1]) + Math.abs(lb - bot[2]) > 15) len++;
          else break;
        }
        if (len > 80) {
          for (let xx = x; xx < x + len; xx++) {
            const topIdx = ((y - 1) * W + xx) * 4;
            const botIdx = ((y + 1) * W + xx) * 4;
            setPixel(px, W, xx, y,
              (rgba[topIdx] + rgba[botIdx]) >> 1,
              (rgba[topIdx + 1] + rgba[botIdx + 1]) >> 1,
              (rgba[topIdx + 2] + rgba[botIdx + 2]) >> 1,
              255);
          }
          y++;
          continue;
        }
      }
      y++;
    }
  }
  return px;
}

// ---------- 主流程 ----------
console.log(`源图：${src}`);
const { width: W, height: H, rgba } = decodePng(fs.readFileSync(src));
console.log(`  尺寸：${W}×${H}`);

// 1. 修复参考线
const cleaned = removeGuideLines(rgba, W, H);
console.log("  ✓ 修复参考线/辅助线");

// 2. 估算背景色（四角），并计算内容边界
const cornerAvg = (() => {
  let r = 0, g = 0, b = 0, n = 0;
  const m = Math.min(40, W >> 3);
  for (const [cx, cy] of [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]]) {
    for (let dy = 0; dy < m; dy++) for (let dx = 0; dx < m; dx++) {
      const x = cx < W / 2 ? dx : W - 1 - dx;
      const y = cy < H / 2 ? dy : H - 1 - dy;
      const i = (y * W + x) * 4;
      r += cleaned[i]; g += cleaned[i + 1]; b += cleaned[i + 2]; n++;
    }
  }
  return [r / n, g / n, b / n];
})();
console.log(`  四角背景色 ≈ rgb(${cornerAvg.map(v => v | 0).join(",")})`);

const isBg = (pr, pg, pb) => {
  const d = Math.abs(pr - cornerAvg[0]) + Math.abs(pg - cornerAvg[1]) + Math.abs(pb - cornerAvg[2]);
  return d < 36;
};

let minX = W, minY = H, maxX = -1, maxY = -1;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = (y * W + x) * 4;
  const a = cleaned[i + 3];
  if (a > 10 && !isBg(cleaned[i], cleaned[i + 1], cleaned[i + 2])) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
}
if (maxX < 0) { console.error("未检测到图标区域"); process.exit(1); }
// 稍微外延，避免切到边缘高光
minX = Math.max(0, minX - 3); minY = Math.max(0, minY - 3);
maxX = Math.min(W - 1, maxX + 3); maxY = Math.min(H - 1, maxY + 3);
const cw = maxX - minX + 1, ch = maxY - minY + 1;
console.log(`  图标包围盒 x[${minX}..${maxX}] y[${minY}..${maxY}] (${cw}x${ch})`);

// 3. 裁剪到正方形，图标居中撑满
const outSize = Math.max(cw, ch);
const offX = ((outSize - cw) / 2) | 0;
const offY = ((outSize - ch) / 2) | 0;
const centered = Buffer.alloc(outSize * outSize * 4);
for (let i = 0; i < outSize * outSize; i++) { centered[i * 4 + 3] = 0; }
for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
  const si = ((minY + y) * W + (minX + x)) * 4;
  const di = ((offY + y) * outSize + (offX + x)) * 4;
  centered[di] = cleaned[si];
  centered[di + 1] = cleaned[si + 1];
  centered[di + 2] = cleaned[si + 2];
  centered[di + 3] = cleaned[si + 3];
}

// 4. 圆角遮罩
const radius = Math.round(Math.min(cw, ch) * 0.22);
const out = Buffer.alloc(outSize * outSize * 4);
for (let y = 0; y < outSize; y++) for (let x = 0; x < outSize; x++) {
  const di = (y * outSize + x) * 4;
  const lx = x - offX, ly = y - offY;
  let keep = false;
  if (lx >= 0 && lx < cw && ly >= 0 && ly < ch) {
    const inCenter = (lx > radius && lx < cw - radius) || (ly > radius && ly < ch - radius);
    if (inCenter) keep = true;
    else {
      const cx = lx < radius ? radius : cw - radius;
      const cy = ly < radius ? radius : ch - radius;
      keep = (lx - cx) ** 2 + (ly - cy) ** 2 <= radius * radius;
    }
  }
  if (keep) {
    out[di] = centered[di]; out[di + 1] = centered[di + 1]; out[di + 2] = centered[di + 2]; out[di + 3] = centered[di + 3];
  } else {
    out[di] = 0; out[di + 1] = 0; out[di + 2] = 0; out[di + 3] = 0;
  }
}

fs.writeFileSync(dst, encodePng(out, outSize));
console.log(`\n✓ 已写出 ${outSize}x${outSize} 透明圆角图标 -> ${dst}`);
