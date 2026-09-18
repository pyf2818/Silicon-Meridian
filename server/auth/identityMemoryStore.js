/**
 * C3 任务 4：身份扩展内存单例（publicId 索引 / 绑定 / 认证）。
 *
 * 独立轻模块（零 PG import）：identityRepository 与 memoryCommunityRepository
 * 共享同一份数据，同时保住「内存模式不拉 PG 依赖链」的边界。
 */
import { __memoryStore } from './memoryAuthRepository.js';

export const publicIdIndex = new Map();   // publicId -> userId
export const identityBindings = new Map();      // `${userId}:${type}` -> record
export const identityVerifications = new Map(); // `${userId}:${type}` -> record

const BADGE_PRIORITY = { creator: 0, enterprise: 1, individual: 2 };

/** 用户最高认证徽章（内存 postView 用）：creator > enterprise > individual，无认证为空串 */
export function bestBadgeFor(userId) {
  const approved = ['individual', 'enterprise', 'creator']
    .map(type => identityVerifications.get(`${userId}:${type}`))
    .filter(record => record && record.status === 'approved');
  if (!approved.length) return '';
  return approved.sort((a, b) => BADGE_PRIORITY[a.type] - BADGE_PRIORITY[b.type])[0].type;
}

/** 按用户清空（测试隔离用） */
export function clearIdentityForTests() {
  publicIdIndex.clear();
  identityBindings.clear();
  identityVerifications.clear();
  for (const row of __memoryStore.users.values()) delete row.public_id;
}

export const __memoryIdentityStore = { publicIdIndex, bindings: identityBindings, verifications: identityVerifications, bestBadgeFor, clearIdentityForTests };
