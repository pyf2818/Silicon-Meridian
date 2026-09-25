/**
 * llmSecrets.js - LLM 配置凭证的存储层加密（AES-256-GCM，底层用 crypto.js）
 *
 * 分层裁决（对抗性审查结论）：
 * - 加解密内聚在 repository 存储边界：snapshotService/editorService 等绕过 service
 *   直调 repository.getLlmConfig 的调用方自动拿到明文，不会 401。
 * - 只做写时升级，不做读时升级：repository.setLlmConfig 是整行覆盖（非 merge），
 *   读时升级存在「覆盖并发写」竞态；明文存量在下次保存时自然升级。
 * - 渐进增强：未配置 MERIDIAN_SECRET 时维持明文存储（现状），配置后写入即加密。
 * - decrypt 失败（密钥轮换）返回原值不抛：数据消费路径（LLM 调用）有自身错误处理，
 *   整链 500 比「单字段不可用」破坏面更大。
 * - 全部返回浅拷贝：内存仓储的 llmConfig 是活引用，原地解密会污染存储。
 */
import { encryptSecret, decryptSecret, looksEncrypted, isEncryptionAvailable } from './crypto.js';

/** llm_config 中需要加密存储的凭证字段（与 profileService 白名单对齐） */
export const LLM_SECRET_KEYS = ['apiKey', 'tavilyKey', 'doubaoSearchKey'];

/** 写入前：非空明文凭证 → 密文。无密钥/加密失败时保明文（渐进增强）。 */
export function encryptLlmSecrets(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return config;
  if (!isEncryptionAvailable()) return config;
  const next = { ...config };
  for (const key of LLM_SECRET_KEYS) {
    const value = next[key];
    if (typeof value === 'string' && value && !looksEncrypted(value)) {
      try {
        next[key] = encryptSecret(value);
      } catch {
        // 保明文：存储加密是增强，不阻塞配置保存主流程
      }
    }
  }
  return next;
}

/** 读出后：密文凭证 → 明文。非密文字段原样；解密失败保原值。 */
export function decryptLlmSecrets(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return config;
  const next = { ...config };
  for (const key of LLM_SECRET_KEYS) {
    const value = next[key];
    if (typeof value === 'string' && looksEncrypted(value)) {
      try {
        next[key] = decryptSecret(value);
      } catch {
        // 密钥轮换/密文损坏：保原值，不炸读路径
      }
    }
  }
  return next;
}
