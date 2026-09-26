/**
 * 零依赖 zip 读取器（技能导入专用，v38）。
 *
 * 为什么手写：项目零第三方依赖（对齐 server/http/multipart.js 的先例），
 * Node 内置 zlib 提供 inflateRaw，这里只补 zip 容器格式（EOCD → central directory → local header → data）。
 *
 * 安全边界（技能 zip 来自不可信社区，全部按恶意输入对待）：
 *   - 拒绝加密条目（general purpose flag bit0）
 *   - 拒绝 ZIP64（本场景不需要 >4GB）与多分卷
 *   - 路径穿越：条目名含 `..` 段、盘符、绝对路径、反斜杠分隔符一律拒绝
 *   - 资源上限：条目数 ≤ 200、单文件解压 ≤ 2MB、总解压 ≤ 20MB（zip bomb 防护）
 *   - 只支持 method 0（store）与 8（deflate）；压缩后大小以 central directory 为准（local header 不可信）
 *
 * 输出：[{ path, data(Buffer) }]，目录条目已被跳过。
 */

import { inflateRawSync } from 'node:zlib';

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

const MAX_ENTRIES = 200;
const MAX_FILE_BYTES = 2 * 1024 * 1024;      // 单文件解压上限 2MB
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;    // 总解压上限 20MB
const MAX_INPUT_BYTES = 10 * 1024 * 1024;    // zip 输入上限 10MB

function zipError(message) {
  return Object.assign(new Error(message), { code: 'INVALID_ZIP' });
}

/** 校验条目路径：相对、正斜杠、无 .. 段、无隐藏目录逃逸。返回归一化路径或抛错。 */
function sanitizeEntryName(rawName) {
  if (!rawName || rawName.length > 256) throw zipError('zip 内存在异常文件名');
  // zip 规范分隔符是 /；反斜杠一律视为可疑（Windows 穿越变体）
  if (rawName.includes('\\')) throw zipError(`zip 条目名含反斜杠（拒绝）：${rawName.slice(0, 80)}`);
  if (/^[a-zA-Z]:/.test(rawName) || rawName.startsWith('/')) throw zipError(`zip 条目为绝对路径（拒绝）：${rawName.slice(0, 80)}`);
  const parts = rawName.split('/').filter(p => p !== '' && p !== '.');
  if (parts.length === 0) return null; // 纯目录条目
  for (const part of parts) {
    if (part === '..') throw zipError(`zip 条目含路径穿越（拒绝）：${rawName.slice(0, 80)}`);
    if (part.startsWith('__MACOSX')) return null; // macOS 垃圾元数据目录整体跳过
  }
  const normalized = parts.join('/');
  // 丢弃目录条目（以 / 结尾被 filter 处理过了；再排除显式 __MACOSX 文件）
  if (rawName.endsWith('/')) return null;
  if (normalized.split('/').some(p => p === '__MACOSX' || p === '.DS_Store')) return null;
  return normalized;
}

/**
 * 解析 zip Buffer，返回 [{ path, data }]。
 * @throws {Error} code=INVALID_ZIP（格式/安全校验失败）
 */
export function readZip(buffer) {
  if (!Buffer.isBuffer(buffer)) throw zipError('zip 输入必须是 Buffer');
  if (buffer.length > MAX_INPUT_BYTES) throw zipError(`zip 超过输入上限（${MAX_INPUT_BYTES / 1024 / 1024}MB）`);
  if (buffer.length < 22) throw zipError('zip 文件过小');

  // ── 1. 从尾部定位 EOCD（注释最长 64KB，往回扫）──
  const scanFrom = Math.max(0, buffer.length - 22 - 65535);
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= scanFrom; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) { eocdOffset = i; break; }
  }
  if (eocdOffset === -1) throw zipError('未找到 zip 中央目录（EOCD），文件损坏或不是 zip');

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let cdOffset = buffer.readUInt32LE(eocdOffset + 16);
  // ZIP64 标记：0xFFFF/0xFFFFFFFF（先于条目数上限检查，给出准确错误）
  if (entryCount === 0xffff || cdOffset === 0xffffffff) throw zipError('不支持 ZIP64 格式 zip');
  if (entryCount > MAX_ENTRIES) throw zipError(`zip 条目数 ${entryCount} 超过上限 ${MAX_ENTRIES}`);
  if (entryCount === 0) throw zipError('zip 为空');

  // ── 2. 遍历 central directory ──
  const out = [];
  let totalBytes = 0;
  let cursor = cdOffset;
  for (let i = 0; i < entryCount; i += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CD_SIG) {
      throw zipError('中央目录损坏');
    }
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const compSize = buffer.readUInt32LE(cursor + 20);
    const uncompSize = buffer.readUInt32LE(cursor + 24);
    const nameLen = buffer.readUInt16LE(cursor + 28);
    const extraLen = buffer.readUInt16LE(cursor + 30);
    const commentLen = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);

    if (flags & 0x0001) throw zipError('zip 含加密条目，不支持');
    if (flags & 0x0008) {
      // data descriptor：大小以 central directory 为准，local header 里的值不可信——继续用 CD 值即可
    }
    const rawName = buffer.slice(cursor + 46, cursor + 46 + nameLen);
    // bit11 (0x0800) = UTF-8 文件名；否则按 latin1 兜底（中文文件名在无 flag 时本就乱码，宁可拒绝）
    const name = (flags & 0x0800)
      ? rawName.toString('utf8')
      : rawName.toString('latin1');

    const safePath = sanitizeEntryName(name);
    if (safePath) {
      if (uncompSize > MAX_FILE_BYTES) throw zipError(`文件 ${safePath} 解压后超过单文件上限 2MB`);
      totalBytes += uncompSize;
      if (totalBytes > MAX_TOTAL_BYTES) throw zipError(`zip 总解压大小超过上限 20MB（zip bomb 防护）`);
    }

    // ── 3. 定位 local header，取真实 data 起点 ──
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== LOCAL_SIG) {
      throw zipError(`条目 ${safePath || name} 的 local header 损坏`);
    }
    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (dataStart + compSize > buffer.length) throw zipError(`条目 ${safePath || name} 数据越界`);

    if (safePath && compSize > 0) {
      const comp = buffer.slice(dataStart, dataStart + compSize);
      let data;
      if (method === 0) {
        data = Buffer.from(comp); // store
        if (data.length !== uncompSize) throw zipError(`条目 ${safePath} store 长度不一致`);
      } else if (method === 8) {
        try {
          data = inflateRawSync(comp);
        } catch {
          throw zipError(`条目 ${safePath} 解压失败（deflate 损坏）`);
        }
        if (data.length !== uncompSize) throw zipError(`条目 ${safePath} 解压后长度与声明不符`);
      } else {
        throw zipError(`条目 ${safePath} 使用不支持的压缩方法 ${method}（仅支持 store/deflate）`);
      }
      out.push({ path: safePath, data });
    }

    cursor += 46 + nameLen + extraLen + commentLen;
  }

  if (out.length === 0) throw zipError('zip 内没有可用文件（可能全是目录/元数据）');
  return out;
}

/** 校验「SKILL.md 是否在解压结果里」（支持根级或单层子目录包裹，返回其所在前缀；技能集合包返回 null） */
export function findSkillMdPrefix(entries) {
  if (entries.some(e => e.path === 'SKILL.md')) return '';
  const nested = entries.filter(e => e.path.endsWith('/SKILL.md') && e.path.indexOf('/') === e.path.lastIndexOf('/'));
  if (nested.length === 1) return nested[0].path.slice(0, nested[0].path.indexOf('/') + 1);
  if (nested.length > 1) return null; // 多个 SKILL.md = 技能集合包，调用方要求用户拆分
  return null;
}

export const ZIP_LIMITS = { MAX_ENTRIES, MAX_FILE_BYTES, MAX_TOTAL_BYTES, MAX_INPUT_BYTES };
