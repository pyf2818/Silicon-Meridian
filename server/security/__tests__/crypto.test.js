import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const {
  encryptSecret, decryptSecret, looksEncrypted,
  maskSecret, maskStoredSecret, safeEqual, isEncryptionAvailable,
} = await import('../crypto.js');

const HEX_KEY = 'a'.repeat(64);
const PASSPHRASE = 'my-passphrase-secret';

describe('crypto（AES-256-GCM 敏感数据加密）', () => {
  let saved;
  beforeEach(() => {
    saved = process.env.MERIDIAN_SECRET;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.MERIDIAN_SECRET;
    else process.env.MERIDIAN_SECRET = saved;
  });

  it('加解密往返（口令 sha256 派生路径）', () => {
    process.env.MERIDIAN_SECRET = PASSPHRASE;
    const cipher = encryptSecret('sk-abcdef1234567890');
    expect(cipher.startsWith('v1:')).toBe(true);
    expect(cipher.split(':')).toHaveLength(4);
    expect(decryptSecret(cipher)).toBe('sk-abcdef1234567890');
  });

  it('加解密往返（64 hex 密钥路径）+ 中文与空串', () => {
    process.env.MERIDIAN_SECRET = HEX_KEY;
    const round = (plain) => decryptSecret(encryptSecret(plain));
    expect(round('sk-abcdef1234567890')).toBe('sk-abcdef1234567890');
    expect(round('中文密钥内容 🔐')).toBe('中文密钥内容 🔐');
    expect(round('')).toBe('');
  });

  it('同一明文两次加密产生不同密文（随机 iv）', () => {
    process.env.MERIDIAN_SECRET = HEX_KEY;
    const c1 = encryptSecret('same-plaintext');
    const c2 = encryptSecret('same-plaintext');
    expect(c1).not.toBe(c2);
    expect(decryptSecret(c1)).toBe('same-plaintext');
    expect(decryptSecret(c2)).toBe('same-plaintext');
  });

  it('未配置 MERIDIAN_SECRET：encrypt/decrypt 抛 ENCRYPTION_UNAVAILABLE（拒绝降级明文）', () => {
    delete process.env.MERIDIAN_SECRET;
    expect(isEncryptionAvailable()).toBe(false);
    expect(() => encryptSecret('x')).toThrowError(/MERIDIAN_SECRET/);
    try {
      encryptSecret('x');
      expect.unreachable('should throw');
    } catch (err) {
      expect(err.code).toBe('ENCRYPTION_UNAVAILABLE');
    }
    try {
      decryptSecret('v1:a:b:c');
      expect.unreachable('should throw');
    } catch (err) {
      expect(err.code).toBe('ENCRYPTION_UNAVAILABLE');
    }
  });

  it('非密文格式 decrypt 抛 NOT_ENCRYPTED（明文兼容路径判断依据）', () => {
    process.env.MERIDIAN_SECRET = HEX_KEY;
    for (const bad of ['plain-key', 'v1:only-three', 'v2:aa:bb:cc', '']) {
      try {
        decryptSecret(bad);
        expect.unreachable(`should throw: ${bad}`);
      } catch (err) {
        expect(err.code).toBe('NOT_ENCRYPTED');
      }
    }
  });

  it('密钥不匹配 / 密文损坏 → DECRYPT_FAILED（不泄漏明文）', () => {
    process.env.MERIDIAN_SECRET = HEX_KEY;
    const cipher = encryptSecret('secret-data');
    // 换密钥后解密
    process.env.MERIDIAN_SECRET = 'b'.repeat(64);
    try {
      decryptSecret(cipher);
      expect.unreachable('should throw');
    } catch (err) {
      expect(err.code).toBe('DECRYPT_FAILED');
    }
    // 篡改密文 body
    process.env.MERIDIAN_SECRET = HEX_KEY;
    const parts = cipher.split(':');
    const tampered = [...parts.slice(0, 3), 'AAAA' + parts[3]].join(':');
    try {
      decryptSecret(tampered);
      expect.unreachable('should throw');
    } catch (err) {
      expect(err.code).toBe('DECRYPT_FAILED');
    }
  });

  it('looksEncrypted：仅 v1 四段格式为 true', () => {
    process.env.MERIDIAN_SECRET = HEX_KEY;
    expect(looksEncrypted(encryptSecret('x'))).toBe(true);
    expect(looksEncrypted('plain-key')).toBe(false);
    expect(looksEncrypted('v1:aa:bb')).toBe(false);
    expect(looksEncrypted('v2:aa:bb:cc')).toBe(false);
    expect(looksEncrypted('')).toBe(false);
    expect(looksEncrypted(null)).toBe(false);
  });

  it('maskSecret：保留前 3 后 4，短串全掩码，空返回空', () => {
    expect(maskSecret('sk-abcdef1234567890')).toBe('sk-***7890');
    expect(maskSecret('123456789')).toBe('123***6789');
    expect(maskSecret('12345678')).toBe('***');
    expect(maskSecret('abc')).toBe('***');
    expect(maskSecret('')).toBe('');
    expect(maskSecret(null)).toBe('');
  });

  it('maskStoredSecret：密文解密后掩码 / 明文直接掩码 / 空返回空', () => {
    process.env.MERIDIAN_SECRET = HEX_KEY;
    const stored = encryptSecret('sk-abcdef1234567890');
    expect(maskStoredSecret(stored)).toBe('sk-***7890');
    expect(maskStoredSecret('sk-abcdef1234567890')).toBe('sk-***7890');
    expect(maskStoredSecret('')).toBe('');
    expect(maskStoredSecret(null)).toBe('');
  });

  it('maskStoredSecret：解密失败（密钥轮换）退固定掩码，展示路径不炸', () => {
    process.env.MERIDIAN_SECRET = HEX_KEY;
    const stored = encryptSecret('sk-abcdef1234567890');
    process.env.MERIDIAN_SECRET = 'b'.repeat(64);
    expect(maskStoredSecret(stored)).toBe('***');
    // 损坏密文同理
    expect(maskStoredSecret('v1:!!!:!!!:!!!')).toBe('***');
  });

  it('safeEqual：等值为 true，不等/不等长为 false', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
    expect(safeEqual(null, '')).toBe(true);
  });
});
