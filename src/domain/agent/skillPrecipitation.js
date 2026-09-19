/**
 * 技能自主沉淀（Agent self-distillation）——纯逻辑，无 React / 无 HTTP / 无副作用。
 *
 * 设计意图（替代旧的「每轮固定弹审批卡」）：
 *   1. 是否沉淀由 Agent 自己判断——复盘一次，让模型评估「本次是否产生了可复用的
 *      方法 / 规则 / 经验」，而不是用 `有工具调用 + 输出够长` 这种粗糙阈值。
 *   2. 判定有价值才落盘，且走内核静默通道（不经工具审批闸门）——不打扰对话流程。
 *   3. 宁可少沉淀：正文过短、无标题、会话内超量的草稿一律拒绝，避免刷出一堆套话。
 *
 * 这里只放确定性的解析 / 校验 / 预筛逻辑，便于单测；模型调用与落盘在 runAgentLoop。
 */

/** 单次会话最多自主沉淀的技能数（防刷屏） */
export const MAX_SKILLS_PER_SESSION = 2;
/** 技能正文最短字数（低于此值视为凑数） */
export const MIN_SKILL_BODY_CHARS = 160;
/** 参与复盘的回答最短字数（更短的回答通常没有方法论含量） */
export const MIN_CONTENT_CHARS = 240;

/** 沉淀模式的 system 追加语：明确「自主判断 + 宁缺毋滥」 */
export const PRECIPITATION_SYSTEM_SUFFIX = [
  '【技能沉淀模式·自主判断】',
  '你正在对刚完成的工作做一次复盘。请自行判断本次是否产生了「可复用的方法、规则或经验」：',
  '- 有：形成了稳定的执行流程、可复用的判断标准、工具组合的最佳实践，或踩过的坑与规避手段',
  '- 没有：一次性信息查询、纯事实问答、未形成方法论的零散操作',
  '只有确有可复用价值才沉淀；宁可少沉淀，也不要为凑数编写通用套话。',
].join('\n');

/** 复盘提示词：要求只输出一个 JSON 决策对象 */
export function buildPrecipitationPrompt() {
  return [
    '请基于刚才的完整工作过程做复盘，并**只输出一个 JSON 对象**（不要 markdown 代码块、不要多余解释）：',
    '{',
    '  "valuable": true 或 false,        // 本次是否产生了可复用的方法/规则/经验',
    '  "reason": "一句话说明判断依据",',
    '  "skill": {                        // valuable=false 时可省略或置 null',
    '    "title": "技能标题（≤30字，动词开头）",',
    '    "description": "一句话说明这个技能解决什么问题（≤80字）",',
    '    "triggers": ["触发关键词"],      // ≤6 个',
    '    "tools": ["用到的工具名"],       // ≤8 个',
    '    "body": "技能正文：适用场景 / 工作流程 / 关键决策点 / 常见陷阱 / 输出要求"',
    '  }',
    '}',
    '判定标准：只有形成了「下次遇到同类任务可以直接照做」的方法或规则，才算 valuable = true。',
  ].join('\n');
}

/**
 * 启发式预筛（省掉一次无谓的 LLM 复盘调用）。
 * 无工具调用 / 回答过短 / 本会话已沉淀足量 → 直接不复盘。
 */
export function shouldAttemptPrecipitation({
  hadToolCalls,
  contentLength,
  sessionSkillCount,
  maxPerSession = MAX_SKILLS_PER_SESSION,
} = {}) {
  if (!hadToolCalls) return false;
  if (!(Number(contentLength) >= MIN_CONTENT_CHARS)) return false;
  if (Number(sessionSkillCount) >= maxPerSession) return false;
  return true;
}

/** 容错解析模型输出：剥 markdown 围栏 → 取首个平衡 JSON 对象 → 归一化决策 */
export function parsePrecipitationDecision(raw) {
  const text = String(raw || '').trim();
  if (!text) return { valuable: false, reason: '空输出', skill: null };
  const cleaned = text.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return { valuable: false, reason: '未输出 JSON', skill: null };
  let obj;
  try {
    obj = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return { valuable: false, reason: 'JSON 解析失败', skill: null };
  }
  return {
    valuable: obj?.valuable === true,
    reason: String(obj?.reason || '').slice(0, 200),
    skill: obj?.skill && typeof obj.skill === 'object' ? obj.skill : null,
  };
}

/** 校验并归一化技能草稿；ok=false 时调用方跳过落盘 */
export function normalizeSkillDraft(draft) {
  if (!draft || typeof draft !== 'object') return { ok: false, reason: '草稿为空' };
  const title = String(draft.title || '').trim().slice(0, 60);
  if (title.length < 2) return { ok: false, reason: '标题缺失' };
  const body = String(draft.body || '').trim();
  if (body.length < MIN_SKILL_BODY_CHARS) {
    return { ok: false, reason: `正文过短（<${MIN_SKILL_BODY_CHARS} 字）` };
  }
  const toList = (v, limit) => (Array.isArray(v) ? v : String(v || '').split(/[,，]/))
    .map(s => String(s).trim())
    .filter(Boolean)
    .slice(0, limit);
  return {
    ok: true,
    skill: {
      title,
      description: String(draft.description || '').trim().slice(0, 200) || `工作技能：${title.slice(0, 30)}`,
      triggers: toList(draft.triggers, 6),
      tools: toList(draft.tools, 8),
      body,
      category: 'work',
    },
  };
}
