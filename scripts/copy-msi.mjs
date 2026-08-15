// 把 Tauri 打包生成的 .msi 从默认输出目录复制到项目根目录。
// Tauri 默认输出：src-tauri/target/release/bundle/msi/*.msi
import { readdirSync, cpSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptDir, '..');
const bundleDir = join(projectRoot, 'src-tauri', 'target', 'release', 'bundle');

// 递归查找第一个 .msi 文件
function findMsi(dir) {
  if (!existsSync(dir)) return null;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      const r = findMsi(full);
      if (r) return r;
    } else if (entry.toLowerCase().endsWith('.msi')) {
      return full;
    }
  }
  return null;
}

const msi = findMsi(bundleDir);
if (!msi) {
  console.error('\n✗ 未找到 .msi 产物。');
  console.error('  请先确认 tauri build 已成功执行（产物应在 src-tauri/target/release/bundle/ 下）。');
  process.exit(1);
}

const fileName = msi.split(/[\\/]/).pop();
const dest = join(projectRoot, fileName);
cpSync(msi, dest, { force: true });
console.log(`\n✓ 安装包已复制到项目根目录：`);
console.log(`  ${dest}`);
