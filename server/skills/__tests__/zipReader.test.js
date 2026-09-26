/**
 * zipReader 单测：手工构造 zip 字节（store/deflate），覆盖正常解析与全部安全拒绝路径。
 * 手工构造 = 测试不依赖外部 zip 库，且能精确控制恶意字段（穿越路径/伪造大小/加密位）。
 */
import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { readZip, findSkillMdPrefix } from '../zipReader.js';

// node:zlib 没有 crc32（Node 22 才有 v20 没有）——自己实现个小 CRC32
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32buf(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 组装一个最小 zip（store 或 deflate） */
function buildZip(entries, opts = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const nameBytes = Buffer.from(e.name, 'utf8');
    const method = e.method || 0;
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data || '');
    const comp = method === 8 ? deflateRawSync(raw) : raw;
    const crc = typeof e.crcOverride === 'number' ? e.crcOverride : crc32buf(raw);
    const flags = e.flags || 0;
    const declaredComp = typeof e.compSizeOverride === 'number' ? e.compSizeOverride : comp.length;
    const declaredUncomp = typeof e.uncompSizeOverride === 'number' ? e.uncompSizeOverride : raw.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x2100, 12); // date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(declaredComp, 18);
    local.writeUInt32LE(declaredUncomp, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // extra len
    locals.push(local, nameBytes, comp);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x2100, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(declaredComp, 20);
    central.writeUInt32LE(declaredUncomp, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38); // ext attrs
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += 30 + nameBytes.length + comp.length;
  }

  const cdStart = offset;
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  const declaredCount = typeof opts.entryCountOverride === 'number' ? opts.entryCountOverride : entries.length;
  eocd.writeUInt16LE(declaredCount, 8);
  eocd.writeUInt16LE(declaredCount, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(cdStart, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cd, eocd]);
}

describe('readZip 正常解析', () => {
  it('store 条目：文件与目录混合', () => {
    const zip = buildZip([
      { name: 'my-skill/', data: '' },
      { name: 'my-skill/SKILL.md', data: '---\nname: my-skill\n---\n# hi' },
      { name: 'my-skill/references/guide.md', data: '# guide' },
    ]);
    const out = readZip(zip);
    expect(out.map(e => e.path)).toEqual(['my-skill/SKILL.md', 'my-skill/references/guide.md']);
    expect(out[0].data.toString('utf8')).toContain('# hi');
  });

  it('deflate 条目正确解压', () => {
    const zip = buildZip([
      { name: 's/scripts/run.py', data: 'print("hello")\n'.repeat(20), method: 8 },
    ]);
    const out = readZip(zip);
    expect(out[0].path).toBe('s/scripts/run.py');
    expect(out[0].data.toString('utf8')).toContain('print("hello")');
  });

  it('跳过 __MACOSX 与 .DS_Store 垃圾', () => {
    const zip = buildZip([
      { name: '__MACOSX/._meta', data: 'junk' },
      { name: 's/.DS_Store', data: 'junk' },
      { name: 's/SKILL.md', data: '---\nname: s\n---\nx' },
    ]);
    const out = readZip(zip);
    expect(out.map(e => e.path)).toEqual(['s/SKILL.md']);
  });

  it('findSkillMdPrefix：根级/单层包裹/集合包', () => {
    const root = [{ path: 'SKILL.md', data: Buffer.from('x') }];
    const nested = [{ path: 'pdf/SKILL.md', data: Buffer.from('x') }, { path: 'pdf/scripts/a.py', data: Buffer.from('x') }];
    const multi = [{ path: 'a/SKILL.md', data: Buffer.from('x') }, { path: 'b/SKILL.md', data: Buffer.from('x') }];
    expect(findSkillMdPrefix(root)).toBe('');
    expect(findSkillMdPrefix(nested)).toBe('pdf/');
    expect(findSkillMdPrefix(multi)).toBeNull();
    expect(findSkillMdPrefix([{ path: 'readme.txt', data: Buffer.from('x') }])).toBeNull();
  });
});

describe('readZip 安全拒绝', () => {
  it('拒绝路径穿越 ../', () => {
    const zip = buildZip([{ name: '../evil.txt', data: 'pwned' }]);
    expect(() => readZip(zip)).toThrow(/穿越/);
  });

  it('拒绝绝对路径', () => {
    const zip = buildZip([{ name: '/etc/passwd', data: 'x' }]);
    expect(() => readZip(zip)).toThrow(/绝对路径/);
  });

  it('拒绝反斜杠分隔符', () => {
    const zip = buildZip([{ name: 'a\\..\\..\\b', data: 'x' }]);
    expect(() => readZip(zip)).toThrow(/反斜杠/);
  });

  it('拒绝加密条目（flag bit0）', () => {
    const zip = buildZip([{ name: 's/SKILL.md', data: 'x', flags: 0x0001 }]);
    expect(() => readZip(zip)).toThrow(/加密/);
  });

  it('拒绝 ZIP64 标记（条目数 0xffff）', () => {
    const zip = buildZip([{ name: 's/SKILL.md', data: 'x' }], { entryCountOverride: 0xffff });
    expect(() => readZip(zip)).toThrow(/ZIP64/);
  });

  it('拒绝声明解压尺寸超过单文件上限（zip bomb）', () => {
    const zip = buildZip([{ name: 'big.bin', data: 'tiny', method: 8, uncompSizeOverride: 5 * 1024 * 1024 }]);
    expect(() => readZip(zip)).toThrow(/单文件上限/);
  });

  it('拒绝非 zip 输入', () => {
    expect(() => readZip(Buffer.from('this is not a zip file at all........'))).toThrow(/EOCD|zip/);
    expect(() => readZip(Buffer.alloc(0))).toThrow();
  });

  it('拒绝伪造条目数（EOCD 声明多于实际 CD）', () => {
    const zip = buildZip([{ name: 's/SKILL.md', data: 'x' }], { entryCountOverride: 5 });
    expect(() => readZip(zip)).toThrow(/损坏/);
  });
});
