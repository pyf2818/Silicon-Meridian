/**
 * useTrailBranches - 智能体会话分支（对标 pi 的 /tree + fork）
 *
 * 现有 AI 精灵历史会话是线性数组。本 hook 提供「从某条历史消息分叉出新会话」能力：
 *   - forkSession(session, { anchorMessageId, prompt })：把一个历史会话在某条消息处分叉，
 *     fork 出一条保留了「父链 + 子树」的新会话消息集
 *
 * 纯逻辑在 trailStore.forkLinearSession；本 hook 只做 React 侧返回值组装（含追加 prompt）。
 */
import { useCallback } from 'react';
import { forkLinearSession } from '../session/trailStore.js';

/**
 * @param {Object} historySession - { id, title, messages[] }
 * @param {Object} [opts]
 * @param {string} [opts.anchorMessageId] - 指定从哪条消息继续（缺省=从末尾）
 * @param {string} [opts.prompt] - 可选：分支首轮问题，会作为新链的锚点（挂在末尾）
 * @returns {{messages: Array}} 树形消息（首条 parentId=null，其余据 parentId 链接）
 */
export function useTrailBranches() {
  const forkSession = useCallback((historySession, opts = {}) => {
    const { anchorMessageId = null, prompt = '' } = opts || {};
    if (!historySession) return { messages: [] };
    const { messages } = forkLinearSession(historySession, { anchorMessageId });
    if (prompt && typeof prompt === 'string' && prompt.trim()) {
      const last = messages[messages.length - 1];
      messages.push({
        id: genLocalId(),
        parentId: last?.id || null,
        role: 'user',
        content: prompt.trim(),
        createdAt: Date.now(),
      });
    }
    return { messages };
  }, []);

  return { forkSession };
}

/** 本地短 id（避免依赖 genTrailId 的随机源差异；与项目风格一致） */
function genLocalId() {
  return `b_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}