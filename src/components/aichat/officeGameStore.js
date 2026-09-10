/**
 * officeGameStore.js - 养成游戏全局状态（模块级单例，模式同 groupChatStore）
 *
 * - coins：团队经费（产出交付 +WORK_REWARD、补贴 +25/15min；发工资/买食物/买家具消耗）
 * - actors：agentId → { hunger, energy, mood, lastPetAt, paidAt, scene, pos }
 *   · scene：员工当前所在场景（'office' | 'lounge'），工作时强制汇聚办公室（视图层处理）
 *   · pos：{ [scene]: {x, y} } 用户拖拽后的自定义位置（百分比）
 * - furniture：{ [scene]: [{id, kind, x, y}] } 玩家自摆放家具（影响场景舒适度 → 心情基础值）
 * - 惰性补账：任何读取都先把 lastTickAt → now 的衰减一次性结算（离线也正确）；补贴同拍补账
 * - 持久化 localStorage 'officeGameState'
 */
import {
  createActorState, tickActors, applyFood, applySalary, applyPet, applyPlay,
  accrueStipend, sceneComfort,
  FOODS, SALARY_COST, WORK_REWARD, FURNITURE, MAX_FURNITURE_PER_SCENE,
} from '../../domain/agent/officeGame.js';

const STORAGE_KEY = 'officeGameState';
const START_COINS = 240;

let furnSeq = 0;

function sanitizeFurniture(raw) {
  const byScene = {};
  for (const scene of ['office', 'lounge']) {
    const list = Array.isArray(raw?.[scene]) ? raw[scene] : [];
    byScene[scene] = list
      .filter(it => it && FURNITURE[it.kind] && Number.isFinite(Number(it.x)) && Number.isFinite(Number(it.y)))
      .slice(0, MAX_FURNITURE_PER_SCENE)
      .map(it => ({ id: String(it.id || `fu_${Date.now().toString(36)}_${furnSeq++}`), kind: it.kind, x: Number(it.x), y: Number(it.y) }));
  }
  return byScene;
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') {
      return {
        coins: Number(parsed.coins) || 0,
        actors: (parsed.actors && typeof parsed.actors === 'object') ? parsed.actors : {},
        furniture: sanitizeFurniture(parsed.furniture),
        lastTickAt: Number(parsed.lastTickAt) || Date.now(),
        lastStipendAt: Number(parsed.lastStipendAt) || Date.now(),
      };
    }
  } catch { /* ignore */ }
  return { coins: START_COINS, actors: {}, furniture: { office: [], lounge: [] }, lastTickAt: Date.now(), lastStipendAt: Date.now() };
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

/** 读取（先补账：属性衰减 + 团队补贴） */
export function getGameState(workStates = {}) {
  // 补贴先行：挂机/离线也有保底进账，保证经济闭环玩得下去
  const stipend = accrueStipend(state.coins, state.lastStipendAt, Date.now());
  state.coins = stipend.coins;
  state.lastStipendAt = stipend.lastStipendAt;
  // 每人所在场景的家具舒适度 → 心情基础值
  const comforts = {};
  for (const [id, a] of Object.entries(state.actors)) {
    comforts[id] = sceneComfort(state.furniture[a.scene || 'office']);
  }
  const { actors, warnings } = tickActors(state.actors, state.lastTickAt, Date.now(), workStates, comforts);
  state.actors = actors;
  state.lastTickAt = Date.now();
  if (stipend.gained > 0) persist(); // 补贴落盘，防刷新后重复入账
  return { coins: state.coins, actors: state.actors, furniture: state.furniture, warnings, stipendGained: stipend.gained };
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

/* ---------- 家具（v26.6）：买入 / 摆放 / 挪动 / 收回 ---------- */

/** 购买并摆放家具。返回 { ok, reason?, item? } */
export function placeFurniture(scene, kind, x, y, workStates = {}) {
  const def = FURNITURE[kind];
  if (!def || (scene !== 'office' && scene !== 'lounge')) return { ok: false, reason: 'no-kind' };
  getGameState(workStates);
  const list = state.furniture[scene] || (state.furniture[scene] = []);
  if (list.length >= MAX_FURNITURE_PER_SCENE) return { ok: false, reason: 'max' };
  if (state.coins < def.cost) return { ok: false, reason: 'no-coins' };
  const item = { id: `fu_${Date.now().toString(36)}_${furnSeq++}`, kind, x, y };
  list.push(item);
  state.coins -= def.cost;
  commit();
  return { ok: true, item, cost: def.cost };
}

/** 挪动已有家具。返回 { ok } */
export function moveFurniture(scene, fid, x, y) {
  const list = state.furniture[scene] || [];
  const item = list.find(it => it.id === fid);
  if (!item) return { ok: false, reason: 'no-item' };
  item.x = x;
  item.y = y;
  commit();
  return { ok: true };
}

/** 收回家具：返还一半购入价。返回 { ok, refund? } */
export function removeFurniture(scene, fid, workStates = {}) {
  const list = state.furniture[scene] || [];
  const idx = list.findIndex(it => it.id === fid);
  if (idx < 0) return { ok: false, reason: 'no-item' };
  getGameState(workStates);
  const [item] = list.splice(idx, 1);
  const refund = Math.ceil((FURNITURE[item.kind]?.cost || 0) / 2);
  state.coins += refund;
  commit();
  return { ok: true, refund };
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
