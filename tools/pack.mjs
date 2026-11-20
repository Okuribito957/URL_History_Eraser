// ZIP打包
//
// 用法：npm run pack  →  dist/url-history-eraser-<版本号>.zip

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 发布包中包含的文件和目录 */
const INCLUDE = ['manifest.json', '_locales', 'icons', 'src', 'LICENSE'];

const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
const outDir = join(ROOT, 'dist');
const outFile = join(outDir, `url-history-eraser-${manifest.version}.zip`);

// ---- 收集文件 ----

/** @param {string} path */
function collect(path) {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return []; // 可选文件（如 LICENSE）不存在时跳过
  }
  if (stat.isFile()) return [path];
  return readdirSync(path)
    .sort()
    .flatMap((name) => collect(join(path, name)));
}

const files = INCLUDE.flatMap((p) => collect(join(ROOT, p)));
if (!files.some((f) => relative(ROOT, f) === 'manifest.json')) {
  throw new Error('找不到 manifest.json');
}

// ---- ZIP 编码 ----

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** @param {Buffer} buf */
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 当前时间转为 DOS 格式的时间和日期 */
function dosDateTime(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

const { time, day } = dosDateTime();
const locals = [];
const centrals = [];
let offset = 0;

for (const file of files) {
  // ZIP 规范要求使用 "/" 分隔路径（Windows 下的 "\" 会导致商店无法识别）
  const name = Buffer.from(relative(ROOT, file).split(sep).join('/'), 'utf8');
  const data = readFileSync(file);
  const compressed = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); // 本地文件头签名
  local.writeUInt16LE(20, 4); // 解压所需版本
  local.writeUInt16LE(0x0800, 6); // 标志：文件名为 UTF-8
  local.writeUInt16LE(8, 8); // 压缩方法：deflate
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(day, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28); // 扩展字段长度
  locals.push(local, name, compressed);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); // 中央目录签名
  central.writeUInt16LE(20, 4); // 创建版本
  central.writeUInt16LE(20, 6); // 解压所需版本
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(time, 12);
  central.writeUInt16LE(day, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  // 30〜41：扩展字段、注释、磁盘号、内部 / 外部属性，均为 0
  central.writeUInt32LE(offset, 42); // 本地文件头的偏移
  centrals.push(central, name);

  offset += local.length + name.length + compressed.length;
}

const centralSize = centrals.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); // 中央目录结束签名
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, Buffer.concat([...locals, ...centrals, end]));

console.log(`已打包 ${files.length} 个文件 → ${relative(ROOT, outFile)}`);
