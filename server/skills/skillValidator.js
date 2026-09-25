/**
 * skillValidator.js - SKILL.md 规范校验器（纯逻辑，零依赖）
 *
 * 与 skillLoader 的解析约定对齐：YAML frontmatter（key: value）+ markdown body。
 * 校验分级：error = 会破坏加载/触发链路；warn = 可用但影响技能被发现与调用质量。
 * 校验是提案不阻塞：loader 侧不强制调用，供 skill 创建/导入路径与运维巡检使用。
 */
export const SKILL_CATEGORY_SUGGESTIONS = [
  'general', 'dev', 'writing', 'analysis', 'workflow', 'ops', 'data', 'research',
];

const KEBAB_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** 校验单个技能（loader 解析产物形状）。返回 { ok, level, issues } */
export function validateSkill({ id, meta = {}, body = '' } = {}) {
  const issues = [];
  const push = (level, field, message) => issues.push({ level, field, message });

  const name = typeof meta.name === 'string' ? meta.name.trim() : '';
  if (name && !KEBAB_RE.test(name)) {
    push('warn', 'name', `name 建议使用 kebab-case（小写字母/数字/连字符），当前：${name}`);
  }
  if (name && id && name !== id && meta.name) {
    // 与目录名不一致时仅提示：loader 会以 frontmatter name 优先，可能造成双 ID
    push('warn', 'name', `frontmatter name（${name}）与目录 id（${id}）不一致，加载以 name 为准`);
  }

  const description = typeof meta.description === 'string' ? meta.description.trim() : '';
  if (!description) {
    push('warn', 'description', '缺少 description：技能列表与触发匹配依赖它，强烈建议补充一句话描述');
  } else if (description.length > 300) {
    push('warn', 'description', `description 过长（${description.length} 字符 > 300），会被检索噪声稀释`);
  }

  const triggers = Array.isArray(meta.triggers) ? meta.triggers : [];
  if (triggers.length === 0) {
    push('warn', 'triggers', '缺少 triggers：matchSkillsByTriggers 无法命中该技能，只能被显式调用');
  } else if (triggers.some(t => typeof t !== 'string' || !t.trim())) {
    push('warn', 'triggers', 'triggers 存在空项或非字符串项');
  }

  const tools = Array.isArray(meta.tools) ? meta.tools : [];
  if (tools.some(t => typeof t !== 'string' || !t.trim())) {
    push('warn', 'tools', 'tools 存在空项或非字符串项');
  }

  const text = String(body || '');
  if (!text.trim()) {
    push('error', 'body', 'SKILL.md 正文为空：加载后无可用指令内容');
  } else if (text.length > 50_000) {
    push('warn', 'body', `正文过长（${text.length} 字符 > 50000）：注入上下文会挤占预算，建议拆分`);
  }

  const category = typeof meta.category === 'string' ? meta.category.trim() : '';
  if (category && !SKILL_CATEGORY_SUGGESTIONS.includes(category)) {
    push('warn', 'category', `category「${category}」不在建议列表（${SKILL_CATEGORY_SUGGESTIONS.join('/')}），仅提示不阻塞`);
  }

  const hasError = issues.some(i => i.level === 'error');
  return { ok: !hasError, level: hasError ? 'error' : issues.length ? 'warn' : 'ok', issues };
}

/** 批量巡检：loader 列表（含 meta/body/id）→ 汇总报告 */
export function validateSkillSet(skills = []) {
  const results = (Array.isArray(skills) ? skills : []).map(s => ({
    id: s?.id || s?.title || '(unknown)',
    ...validateSkill(s),
  }));
  return {
    total: results.length,
    errorCount: results.filter(r => r.level === 'error').length,
    warnCount: results.filter(r => r.level === 'warn').length,
    cleanCount: results.filter(r => r.level === 'ok').length,
    results,
  };
}
