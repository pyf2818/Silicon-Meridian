/**
 * 稳定 ID 工厂（本地数据用，非加密安全场景）
 *
 * 优先用 crypto.randomUUID；不可用时退化为 时间戳+随机串。
 * 抽成独立模块的原因：hook 与 domain 纯逻辑都要造 ID，两处各写一份必然会漂移。
 */
export function createStableId(prefix = 'id') {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
