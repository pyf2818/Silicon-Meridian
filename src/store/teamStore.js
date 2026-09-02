/**
 * teamStore.js - Agent Team 共享状态（模块级单例 store，模式与 sessionStore.js 一致）
 *
 * 团队任务列表与邮箱消息是**真正的共享状态**：lead 与多个队友（各自独立的
 * runToolLoop）通过本 store 读写同一份任务板——这是 agent team 协作的物理基础。
 *
 * - 按 teamId 隔离，多个团队可并存
 * - 持久化到 localStorage 'agentTeamState'（最近 10 个团队）
 * - subscribe 模式让 UI（团队看板）自动同步
 */

const STORAGE_KEY = 'agentTeamState';
const MAX_TEAMS = 10;

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

const state = {
  teams: loadFromStorage(), // { [teamId]: { id, goal, teammates, tasks, messages, status, createdAt, updatedAt } }
};

const listeners = new Set();

function notify() {
  listeners.forEach(fn => { try { fn(state); } catch { /* ignore */ } });
}

function persist() {
  try {
    const entries = Object.entries(state.teams)
      .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
      .slice(0, MAX_TEAMS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch { /* QuotaExceededError 等忽略 */ }
}

export function getTeam(teamId) {
  return state.teams[teamId] || null;
}

/** 创建团队（plan 来自 teamCore.normalizeTeamPlan） */
export function createTeam(plan) {
  if (!plan?.teamId) return null;
  const team = {
    id: plan.teamId,
    goal: plan.goal || '',
    teammates: plan.teammates || [],
    tasks: plan.tasks || [],
    messages: [],
    status: 'running',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  state.teams[team.id] = team;
  persist();
  notify();
  return team;
}

/** 更新任务（patch 已由调用方用 teamCore.applyTaskStatusTransition 校验） */
export function updateTeamTask(teamId, taskId, patch) {
  const team = state.teams[teamId];
  if (!team) return null;
  const idx = team.tasks.findIndex(t => t.id === taskId);
  if (idx === -1) return null;
  team.tasks[idx] = { ...team.tasks[idx], ...patch, updatedAt: Date.now() };
  team.updatedAt = Date.now();
  persist();
  notify();
  return team.tasks[idx];
}

/** 追加团队消息（超出上限时丢弃最旧的） */
export function postTeamMessage(teamId, message) {
  const team = state.teams[teamId];
  if (!team || !message) return null;
  team.messages.push(message);
  if (team.messages.length > 100) {
    team.messages = team.messages.slice(-100);
  }
  team.updatedAt = Date.now();
  persist();
  notify();
  return message;
}

/** 团队结束标记（lead 汇总后置为 completed） */
export function finishTeam(teamId, status = 'completed') {
  const team = state.teams[teamId];
  if (!team) return null;
  team.status = status;
  team.updatedAt = Date.now();
  persist();
  notify();
  return team;
}

export function subscribeTeams(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** UI 用：最近团队列表（新→旧） */
export function listTeams() {
  return Object.values(state.teams)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
