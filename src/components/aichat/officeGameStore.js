/**
 * officeGameStore.js - 养成游戏全局状态（模块级单例，模式同 groupChatStore）
 *
 * - coins：团队经费（产出交付 +WORK_REWARD，发工资/买食物消耗）
 * - actors：agentId → { hunger, energy, mood, lastPetAt, paidAt, scene, pos }
 *   · scene：员工当前所在场景（'office' | 'lounge'），工作时强制汇聚办公室（视图层处理）
 *   · pos：{ [scene]: {x, y} } 用户拖拽后的自定义位置（百分比）
 * - 惰性补账：任何读取都先把 lastTickAt → now 的衰减一次性结算（离线也正确）
 * - 持久化 localStorage 'officeGameState'
 */
import {
  createActorState, tickActors, applyFood, applySalary, applyPet, applyPlay,
  FOODS, SALARY_COST, WORK_REWARD,
} from '../../domain/agent/officeGame.js';

const STORAGE_KEY = 'officeGameState';
const START_COINS = 240;

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') {
      return {
        coins: Number(parsed.coins) || 0,
        actors: (parsed.actors && typeof parsed.actors === 'object') ? parsed.actors : {},
        lastTickAt: Number(parsed.lastTickAt) || Date.now(),
      };
    }
  } catch { /* ignore */ }
  return { coins: START_COINS, actors: {}, lastTickAt: Date.now() };
}

let state = load();
const listeners = new Set();

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

function notify() {
  listeners.forEach(fn => { try { fn(); } catch { /* ignore */ } });
}

function ensureActor(actorId) {
  if (!state.actors[actorId]) state.actors[actorId] = createActorState();
  const a = state.actors[actorId];
  if (typeof a.hunger !== 'number') a.hunger = 80;
  if (typeof a.energy !== 'number') a.energy = 90;
  if (typeof a.mood !== 'number') a.mood = 70;
  if (!a.scene) a.scene = 'office';
  return a;
}

/** 读取（先补账） */
export function getGameState(workStates = {}) {
  const { actors, warnings } = tickActors(state.actors, state.lastTickAt, Date.now(), workStates);
  state.actors = actors;
  state.lastTickAt = Date.now();
  return { coins: state.coins, actors: state.actors, warnings };
}

/** 确保成员有初始档案（新成员入群时调用，否则属性条会显示 0） */
export function ensureActors(agentIds = []) {
  let changed = false;
  for (const id of agentIds) {
    if (!state.actors[id]) { ensureActor(id); changed = true; }
  }
  if (changed) commit();
}

export function subscribeGame(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function commit() { persist(); notify(); }

/** 投喂：扣经费 + 属性结算。返回 { ok, reason } */
export function feedActor(agentId, foodId, workStates = {}) {
  const food = FOODS[foodId];
  if (!food) return { ok: false, reason: 'no-food' };
  getGameState(workStates); // 先结算
  const actor = ensureActor(agentId);
  const res = applyFood(actor, food);
  if (!res.ok) return res;
  if (state.coins < food.cost) return { ok: false, reason: 'no-coins' };
  state.actors[agentId] = res.actor;
  state.coins -= food.cost;
  commit();
  return { ok: true, food };
}

/** 发工资：扣经费 + 心情大提升。返回 { ok, reason } */
export function paySalary(agentId, workStates = {}) {
  getGameState(workStates);
  const actor = ensureActor(agentId);
  if (state.coins < SALARY_COST) return { ok: false, reason: 'no-coins' };
  const res = applySalary(actor, Date.now());
  state.actors[agentId] = res.actor;
  state.coins -= SALARY_COST;
  commit();
  return { ok: true };
}

/** 抚摸（点击）：冷却 3s。返回 { ok, reason } */
export function petActor(agentId, workStates = {}) {
  getGameState(workStates);
  const actor = ensureActor(agentId);
  const res = applyPet(actor, Date.now());
  state.actors[agentId] = res.actor;
  if (res.ok) commit();
  return res;
}

/** 逗趣（冷却中再点）：消耗一点精力换小心情。 */
export function playWithActor(agentId, workStates = {}) {
  getGameState(workStates);
  const actor = ensureActor(agentId);
  const res = applyPlay(actor, Date.now());
  state.actors[agentId] = res.actor;
  if (res.ok) commit();
  return res;
}

/** 拖拽落位：记录某成员在某场景的自定义位置 */
export function setActorPos(agentId, scene, pos) {
  const actor = ensureActor(agentId);
  actor.scene = scene;
  actor.pos = { ...(actor.pos || {}), [scene]: { x: pos.x, y: pos.y } };
  commit();
}

/** 员工切换场景（休息区/办公室） */
export function setActorScene(agentId, scene) {
  const actor = ensureActor(agentId);
  actor.scene = scene;
  commit();
}

/** 产出交付奖励：经费 +WORK_REWARD。返回是否真的入账（去重由调用方控制） */
export function grantWorkReward() {
  state.coins += WORK_REWARD;
  commit();
  return state.coins;
}

/** Goal 达成：全员经费 + 心情彩蛋（发奖金） */
export function grantGoalBonus(agentIds = []) {
  state.coins += WORK_REWARD * 3;
  for (const id of agentIds) {
    const actor = ensureActor(id);
    actor.mood = Math.min(100, actor.mood + 20);
  }
  commit();
  return state.coins;
}
