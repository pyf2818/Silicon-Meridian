/**
 * officeScene.js - 像素办公室协作监测面板的纯逻辑（v26 #15）
 *
 * 从团队群聊消息流推导「办公室场景」所需的视图状态：
 * - deriveOfficeActivity：每个成员的当前状态（idle/claiming/claimed/working/done）
 *   规则：最新一条 agent 消息说话 —— running=执行中（claim 阶段=思考中）；
 *   刚完成的 work 在时间窗内=已交付；刚认领在时间窗内=已认领；否则=空闲。
 * - deriveOfficeEvents：自上次游标以来的新事件（驱动对话气泡），含创始人发言。
 *
 * 全部为纯函数，时间由外部注入（可测试）；窗口常量显式可调。
 */

export const OFFICE_STATUS = ['idle', 'claiming', 'claimed', 'working', 'done'];

export const OFFICE_STATUS_LABEL = {
  idle: '空闲',
  claiming: '思考中',
  claimed: '已认领',
  working: '执行中',
  done: '已交付',
};

const DEFAULT_DONE_WINDOW_MS = 3 * 60_000;   // 交付后 3 分钟内显示「已交付」
const DEFAULT_CLAIM_WINDOW_MS = 3 * 60_000;  // 认领后 3 分钟内显示「已认领」

/**
 * 推导每个成员的办公室状态。
 * @param {Array} messages 群聊消息（agent 消息需含 agentId/meta.phase/status/at）
 * @param {Array} rosterIds 成员 id 顺序（决定返回顺序）
 * @param {number} now 当前时间戳
 * @returns {Array<{agentId: string, status: string, lastAt: number, lastContent: string}>}
 */
export function deriveOfficeActivity(messages, rosterIds, now = Date.now(), {
  doneWindowMs = DEFAULT_DONE_WINDOW_MS,
  claimWindowMs = DEFAULT_CLAIM_WINDOW_MS,
} = {}) {
  const latestByAgent = new Map();
  for (const m of (messages || [])) {
    if (!m || m.role !== 'agent' || !m.agentId) continue;
    const prev = latestByAgent.get(m.agentId);
    if (!prev || (m.at || 0) >= (prev.at || 0)) latestByAgent.set(m.agentId, m);
  }
  return (rosterIds || []).map((id) => {
    const m = latestByAgent.get(id);
    let status = 'idle';
    if (m) {
      const phase = m.meta?.phase;
      const kind = m.meta?.kind;
      const age = now - (m.at || 0);
      if (m.status === 'running') {
        status = phase === 'work' ? 'working' : 'claiming';
      } else if (phase === 'work' && m.status === 'done' && age >= 0 && age < doneWindowMs) {
        status = 'done';
      } else if (phase === 'claim' && m.status === 'done' && kind === 'claim' && age >= 0 && age < claimWindowMs) {
        status = 'claimed';
      }
    }
    return {
      agentId: id,
      status,
      lastAt: m?.at || 0,
      lastContent: String(m?.content || '').slice(0, 80),
    };
  });
}

/**
 * 推导自 lastSeenAt 以来的新事件（驱动气泡）。
 * 事件按时间正序返回（旧→新），每条 { agentId, kind, text, at }；
 * agentId 为 '_founder' 表示创始人发言；系统行（含 goal 事件）不产生成员气泡。
 * @returns {Array} 最多 limit 条
 */
export function deriveOfficeEvents(messages, lastSeenAt, now = Date.now(), limit = 8) {
  const events = [];
  for (const m of (messages || [])) {
    if (!m || !m.at || m.at <= (lastSeenAt || 0) || m.at > now + 1000) continue;
    if (m.status === 'running') continue; // 流式中的占位不气泡，完成/认领落定时再报
    if (m.role === 'user') {
      events.push({ agentId: '_founder', kind: 'user', text: String(m.content || '').slice(0, 40), at: m.at });
    } else if (m.role === 'agent' && m.agentId && m.content) {
      const phase = m.meta?.phase;
      const kind = m.meta?.kind;
      const text = phase === 'claim'
        ? (kind === 'claim' ? '认领了任务' : kind === 'watch' ? '表示关注' : '选择旁观')
        : (String(m.status) === 'done' ? '交付了产出' : '遇到了问题');
      events.push({ agentId: m.agentId, kind: phase === 'claim' ? 'claim' : 'work', text, at: m.at });
    }
  }
  return events.slice(-limit);
}
