/**
 * agentEvolution.js - Agent 进化档案（v26 #13：自主进化 + 工作经验沉淀 + 进化树）
 *
 * 模拟人类多层记忆中的「经验层 / 语义记忆」：
 * - L1 工作记忆 = 会话消息（sessionStore）
 * - L2 情景记忆 = 跨会话相关记忆（sessionMemory + 服务端 agent_memories）
 * - L3 经验记忆 = 本模块：每次真实工作后沉淀的「topic + lesson」条目（去重、封顶）
 * - L4 进化统计 = 本模块：runs/tokens/toolCalls/skills 累计 → 成长值 → 等级 + 里程碑
 *
 * 设计约束（对抗性审查后收口）：
 * - 纯 localStorage，无服务端依赖（dev 无 PG 也能跑）
 * - 所有写入做类型清洗 + 封顶（经验 60 条/agent、里程碑 40 条），防止无限膨胀
 * - 经验去重按 lesson 的稳定哈希，避免同一结论反复入库
 * - 等级只增不减（降级会打击感）；里程碑在升级时自动记录，构成进化树节点
 */

const STORAGE_KEY = 'agentEvolutionProfiles';
const MAX_EXPERIENCES = 60;
const MAX_MILESTONES = 40;

/** 等级阶梯：score = runs*2 + toolCalls*0.5 + tokens/4000 + skills*8 + experiences*5 */
export const EVOLUTION_LEVELS = [
  { level: 0, name: '种子', minScore: 0, hint: '刚刚发芽，等待第一次真实任务' },
  { level: 1, name: '萌芽', minScore: 10, hint: '开始积累实战经验' },
  { level: 2, name: '成长', minScore: 40, hint: '能独立处理常见任务' },
  { level: 3, name: '熟练', minScore: 100, hint: '经验库开始产生复利' },
  { level: 4, name: '专家', minScore: 220, hint: '对用户偏好的把握接近默契' },
  { level: 5, name: '大师', minScore: 400, hint: '与用户形成稳定的协作心智' },
];

/** 稳定字符串哈希（经验去重用） */
function hashStr(s) {
  const str = String(s || '');
  let h = 5381;
  for (let i = 0; i < str.length; i += 1) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return h;
}

function emptyProfile() {
  return {
    stats: { runs: 0, toolCalls: 0, tokens: 0, skills: 0, goalRounds: 0, lastAt: 0 },
    experiences: [], // { id, at, topic, lesson, source }
    milestones: [],  // { id, at, level, label }
  };
}

function loadProfiles() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch { return {}; }
}

let profiles = null;
const listeners = new Set();

/** 惰性加载：首次访问才读 storage（避免 import 顺序依赖 localStorage，测试环境友好） */
function loadAll() {
  if (profiles) return profiles;
  profiles = loadProfiles();
  return profiles;
}

/** 仅供测试：清空内存缓存，下次访问重新从 storage 读取 */
export function __resetEvolutionCache() { profiles = null; }

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles)); } catch { /* QuotaExceeded 等忽略 */ }
}

function notify() {
  listeners.forEach(fn => { try { fn(); } catch { /* ignore */ } });
}

export function subscribeEvolution(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function ensureProfile(agentId) {
  const all = loadAll();
  if (!all[agentId] || typeof all[agentId] !== 'object') {
    all[agentId] = emptyProfile();
  }
  const p = all[agentId];
  if (!p.stats || typeof p.stats !== 'object') p.stats = emptyProfile().stats;
  if (!Array.isArray(p.experiences)) p.experiences = [];
  if (!Array.isArray(p.milestones)) p.milestones = [];
  return p;
}

export function getEvolutionScore(stats) {
  const s = stats || {};
  return Math.round(
    (Number(s.runs) || 0) * 2
    + (Number(s.toolCalls) || 0) * 0.5
    + (Number(s.tokens) || 0) / 4000
    + (Number(s.skills) || 0) * 8
    + (Number(s.experienceCount) || 0) * 5,
  );
}

/** 由成长值求等级（只升不降由调用方保证：milestone 只在跨过阈值时记录一次） */
export function evolutionLevelOf(score) {
  let cur = EVOLUTION_LEVELS[0];
  for (const lv of EVOLUTION_LEVELS) if (score >= lv.minScore) cur = lv;
  const next = EVOLUTION_LEVELS.find(lv => lv.minScore > cur.minScore) || null;
  return { ...cur, score, next };
}

/** 读取某 agent 的进化档案（返回副本，防外部直接改） */
export function getEvolution(agentId) {
  if (!agentId) return emptyProfile();
  const p = ensureProfile(agentId);
  const stats = { ...p.stats, experienceCount: p.experiences.length };
  const lv = evolutionLevelOf(getEvolutionScore(stats));
  return {
    stats,
    experiences: [...p.experiences].sort((a, b) => b.at - a.at),
    milestones: [...p.milestones].sort((a, b) => a.level - b.level),
    level: lv,
  };
}

/** 一次真实工作结束后的统计累计（runs/tokens/toolCalls/skills）。
 *  跨过等级阈值时自动写入里程碑（进化树节点）。返回是否升级。 */
export function recordAgentRun(agentId, { tokens = 0, toolCalls = 0, skillsUsed = 0, goalRounds = 0 } = {}) {
  if (!agentId) return false;
  const p = ensureProfile(agentId);
  p.stats.runs = (Number(p.stats.runs) || 0) + 1;
  p.stats.tokens = (Number(p.stats.tokens) || 0) + (Number(tokens) || 0);
  p.stats.toolCalls = (Number(p.stats.toolCalls) || 0) + (Number(toolCalls) || 0);
  p.stats.skills = (Number(p.stats.skills) || 0) + (Number(skillsUsed) || 0);
  p.stats.goalRounds = (Number(p.stats.goalRounds) || 0) + (Number(goalRounds) || 0);
  p.stats.lastAt = Date.now();
  const before = evolutionLevelOf(getEvolutionScore({ ...p.stats, experienceCount: p.experiences.length }));
  // 以「本次累计后」的等级为准，检查是否需要补里程碑
  let leveledUp = false;
  const existingLevels = new Set(p.milestones.map(m => m.level));
  if (!existingLevels.has(before.level) && before.level > 0) {
    p.milestones = [...p.milestones, {
      id: `ms_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      at: Date.now(),
      level: before.level,
      label: `晋升 ${before.name}（Lv${before.level}）`,
    }].slice(-MAX_MILESTONES);
    leveledUp = true;
  }
  persist();
  notify();
  return leveledUp;
}

/** 沉淀一条工作经验（去重 + 封顶）。返回是否真的写入了。 */
export function depositExperience(agentId, { topic = '', lesson = '', source = 'run' } = {}) {
  if (!agentId) return false;
  const text = String(lesson || '').trim();
  if (text.length < 8) return false; // 太短的经验没有沉淀价值
  const p = ensureProfile(agentId);
  const h = hashStr(text.slice(0, 200));
  if (p.experiences.some(e => e.hash === h)) return false; // 重复结论不入库
  p.experiences = [...p.experiences, {
    id: `ex_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
    hash: h,
    at: Date.now(),
    topic: String(topic || '').trim().slice(0, 60),
    lesson: text.slice(0, 300),
    source: String(source || 'run').slice(0, 24),
  }].slice(-MAX_EXPERIENCES);
  persist();
  notify();
  return true;
}

/** 删除某条经验（用户在进化档案里手动清理噪声） */
export function removeExperience(agentId, expId) {
  if (!agentId) return false;
  const p = ensureProfile(agentId);
  const before = p.experiences.length;
  p.experiences = p.experiences.filter(e => e.id !== expId);
  if (p.experiences.length !== before) { persist(); notify(); return true; }
  return false;
}

/** 生成 system prompt 注入段：等级 + 最有价值的近期经验（≤8 条）。
 *  经验是「agent 自己的工作记忆结晶」，放指令区前部、证据区之前。 */
export function evolutionPromptSnippet(agentId) {
  if (!agentId) return '';
  try {
    const evo = getEvolution(agentId);
    if (!evo.experiences.length && evo.level.level === 0) return '';
    const lines = [`你是${evo.level.name}级（Lv${evo.level.level}）智能体，共完成 ${evo.stats.runs || 0} 次真实任务。`];
    if (evo.experiences.length) {
      lines.push('以下是你在以往工作中沉淀的经验（按时间倒序，仅供参考与复用，避免重复踩坑）：');
      for (const ex of evo.experiences.slice(0, 8)) {
        lines.push(`  - ${ex.topic ? `【${ex.topic}】` : ''}${ex.lesson}`);
      }
    }
    return `【成长经验】\n${lines.join('\n')}`;
  } catch { return ''; }
}
