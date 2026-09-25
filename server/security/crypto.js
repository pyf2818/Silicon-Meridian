/**
 * crypto.js - 服务端敏感数据加密（AES-256-GCM）
 *
 * 用途：LLM apiKey 等凭证的服务端加密存储（对齐 WorkBuddy credentials/ 语义）。
 * 密钥来源：env MERIDIAN_SECRET（64 hex 字符 = 32 字节，或任意长度口令经 sha256 派生）。
 * 未配置密钥时：encrypt 抛错（调用方应拒绝写入而非降级明文），decrypt 抛错（密文不可读）。
 *
 * 密文格式：v1:<iv-b64>:<tag-b64>:<data-b64>（版本前缀便于未来轮换）
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const VERSION = 'v1';
const ALGO = 'aes-256-gcm';

function deriveKey() {
  const secret = process.env.MERIDIAN_SECRET || '';
  if (!secret) return null;
  if (/^[0-9a-f]{64}$/i.test(secret)) return Buffer.from(secret, 'hex');
  return createHash('sha256').update(secret, 'utf8').digest();
}

export function isEncryptionAvailable() {
  return deriveKey() !== null;
}

/** 加密 utf-8 明文 → v1 密文串。未配置 MERIDIAN_SECRET 抛 ENCRYPTION_UNAVAILABLE */
export function encryptSecret(plaintext) {
  const key = deriveKey();
  if (!key) {
    throw Object.assign(new Error('未配置 MERIDIAN_SECRET，无法加密存储'), { code: 'ENCRYPTION_UNAVAILABLE' });
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const data = Buffer.concat([cipher.update(String(plaintext ?? ''), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`;
}

/** 解密 v1 密文串 → utf-8 明文。非密文格式抛 NOT_ENCRYPTED（调用方可走明文兼容路径） */
export function decryptSecret(payload) {
  const key = deriveKey();
  if (!key) {
    throw Object.assign(new Error('未配置 MERIDIAN_SECRET，无法解密'), { code: 'ENCRYPTION_UNAVAILABLE' });
  }
  const raw = String(payload ?? '');
  const parts = raw.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw Object.assign(new Error('非加密格式'), { code: 'NOT_ENCRYPTED' });
  }
  try {
    const iv = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const data = Buffer.from(parts[3], 'base64');
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    throw Object.assign(new Error('解密失败（密钥不匹配或密文损坏）'), { code: 'DECRYPT_FAILED' });
  }
}

/** 是否为本模块密文格式（读时升级判断用） */
export function looksEncrypted(payload) {
  const raw = String(payload ?? '');
  return raw.startsWith(`${VERSION}:`) && raw.split(':').length === 4;
}

/** 掩码回显：sk-abcdef1234567890 → sk-***7890（保留前 3 后 4） */
export function maskSecret(plaintext) {
  const s = String(plaintext ?? '');
  if (!s) return '';
  if (s.length <= 8) return '***';
  return `${s.slice(0, 3)}***${s.slice(-4)}`;
}

/** 掩码密文字段：已加密 → 解密后掩码；明文 → 直接掩码；空 → 空。
 *  解密失败（密钥轮换）时退回固定掩码，不抛错（展示路径不允许炸）。 */
export function maskStoredSecret(stored) {
  const raw = String(stored ?? '');
  if (!raw) return '';
  if (looksEncrypted(raw)) {
    try {
      return maskSecret(decryptSecret(raw));
    } catch {
      return '***';
    }
  }
  return maskSecret(raw);
}

/** 常量时间比较（审计/校验用） */
export function safeEqual(a, b) {
  const ba = Buffer.from(String(a ?? ''));
  const bb = Buffer.from(String(b ?? ''));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
