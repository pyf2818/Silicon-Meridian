/**
 * officeGame.js - 像素养成模拟游戏纯逻辑（v26 #17）
 *
 * 三维属性（0-100，越高越好）：
 * - hunger 饱食度：随时间衰减（约 2 小时满→空），投喂恢复
 * - energy 精力：工作时加速消耗，休息时缓慢回复
 * - mood 心情：向「基础值」漂移（基础值由饱食/精力/在岗决定）+ 即时事件加成
 *
 * 经济闭环（v26.6 调平衡）：
 * - 收入：产出交付 +30；Goal 达成 +90；团队补贴 +25/15min（挂机也有进账，不会破产卡死）
 * - 支出：发工资 80/人、食物 10~20 币、家具 15~45 币（收回返一半）
 * - 家具提升场景舒适度（每件 +2 心情基础值，封顶 +12），花钱有实际收益
 * 时间衰减支持「补账」：离线多久就按 elapsed 一次性衰减（封顶 24h），打开游戏即正确。
 * 全部纯函数，时间外部注入（可测试）。
 */

export const STAT_LIMITS = { min: 0, max: 100 };

/** 食物菜单：cost 经费 / hunger 饱食 / energy 精力 / mood 心情（即时变化，可负） */
export const FOODS = {
  riceball: { id: 'riceball', label: '饭团', cost: 10, hunger: 30, energy: 6, mood: 2 },
  coffee: { id: 'coffee', label: '咖啡', cost: 15, hunger: 4, energy: 34, mood: 3 },
  cake: { id: 'cake', label: '蛋糕', cost: 20, hunger: 12, energy: 4, mood: 18 },
};

export const SALARY_COST = 80;    // 发工资单人成本
export const SALARY_MOOD = 30;    // 发工资心情加成
export const PET_COOLDOWN_MS = 3000;
export const PET_MOOD = 6;        // 抚摸心情加成
export const WORK_REWARD = 30;    // 一次产出交付的经费奖励
export const WORK_START_MOOD = -2; // 开始干活的小心情消耗（打工人实感）
export const MAX_CATCHUP_MS = 24 * 3600_000;

/** 团队补贴：挂机保底收入，保证数值能玩下去 */
export const STIPEND_AMOUNT = 25;          // 每次入账
export const STIPEND_INTERVAL_MS = 15 * 60_000; // 每 15 分钟一拍

/** 家具目录：cost 购入价（收回返还一半） */
export const FURNITURE = {
  plant: { id: 'plant', label: '绿植', cost: 15 },
  lamp: { id: 'lamp', label: '落地灯', cost: 25 },
  cooler: { id: 'cooler', label: '饮水机', cost: 30 },
  cabinet: { id: 'cabinet', label: '文件柜', cost: 35 },
  bookshelf: { id: 'bookshelf', label: '书架', cost: 45 },
};
export const MAX_FURNITURE_PER_SCENE = 8;

/** 每分钟衰减速率（v26.6 调慢：满饱食约 3.7h，玩得起来不焦虑） */
export const DECAY_PER_MIN = {
  hunger: 0.45,
  energyWorking: 0.9,   // 在岗（执行中/思考中）
  energyIdle: -0.5,     // 空闲为负数 = 回复精力
};

export function createActorState() {
  return { hunger: 80, energy: 90, mood: 70, lastPetAt: 0, paidAt: 0 };
}

function clamp100(v) {
  return Math.max(STAT_LIMITS.min, Math.min(STAT_LIMITS.max, v));
}

/** 心情基础值：吃饱 + 精力足 + 最近被发过工资 → 心情底子好；家具舒适度额外加成 */
export function moodBase(actor, working, comfort = 0) {
  const hungerPart = (actor.hunger - 50) * 0.24;   // -12 ~ +12
  const energyPart = (actor.energy - 50) * 0.20;   // -10 ~ +10
  const workPart = working ? -4 : 3;               // 干活略压心情，摸鱼微涨
  return clamp100(62 + hungerPart + energyPart + workPart + comfort);
}

/** 场景舒适度：每件家具 +2，封顶 +12（花钱布置有实际收益） */
export function sceneComfort(list = []) {
  return Math.min(12, list.length * 2);
}

/** 团队补贴结算：按 elapsed 整拍入账（离线补账同样适用，不重复计费） */
export function accrueStipend(coins, lastStipendAt, now) {
  const base = lastStipendAt || now;
  const elapsed = Math.max(0, Math.min(MAX_CATCHUP_MS, now - base));
  const ticks = Math.floor(elapsed / STIPEND_INTERVAL_MS);
  if (ticks <= 0) return { coins, lastStipendAt: base, gained: 0 };
  return { coins: coins + ticks * STIPEND_AMOUNT, lastStipendAt: base + ticks * STIPEND_INTERVAL_MS, gained: ticks * STIPEND_AMOUNT };
}

/**
 * 时间推进（补账式）：对全部成员按 elapsed 毫秒衰减/回复 + 心情向基础值漂移。
 * @param {Object} actors agentId → actorState
 * @param {number} lastTickAt 上次结算时间戳
 * @param {number} now 当前时间戳
 * @param {Object} workStates agentId → boolean（是否在岗执行）
 * @param {Object} comforts agentId → number（所在场景的家具舒适度加成）
 * @returns {{ actors: Object, warnings: Array<{agentId, kind}> }}
 *  warnings：跨过警戒线的成员（饿/累/心情低），每次结算只报新越线者
 */
export function tickActors(actors, lastTickAt, now, workStates = {}, comforts = {}) {
  const elapsed = Math.max(0, Math.min(MAX_CATCHUP_MS, now - (lastTickAt || now)));
  const minutes = elapsed / 60000;
  const next = {};
  const warnings = [];
  const prev = actors || {};
  for (const [id, a0] of Object.entries(prev)) {
    const working = Boolean(workStates[id]);
    const hunger = clamp100(a0.hunger - DECAY_PER_MIN.hunger * minutes);
    const energy = clamp100(a0.energy - (working ? DECAY_PER_MIN.energyWorking : DECAY_PER_MIN.energyIdle) * minutes);
    const base = moodBase({ ...a0, hunger, energy }, working, comforts[id] || 0);
    const mood = clamp100(a0.mood + (base - a0.mood) * Math.min(1, 0.06 * minutes));
    next[id] = { ...a0, hunger, energy, mood };
    // 警戒线：只在「从安全到危险」的跨越瞬间报警，避免反复刷
    if (a0.hunger >= 20 && hunger < 20) warnings.push({ agentId: id, kind: 'hungry' });
    if (a0.energy <= 25 && energy > 25) warnings.push({ agentId: id, kind: 'tired' });
    if (a0.mood >= 30 && mood < 30) warnings.push({ agentId: id, kind: 'sad' });
  }
  return { actors: next, warnings };
}

/** 投喂：返回 { actor, ok, reason }。饱食度满（≥98）时拒食。 */
export function applyFood(actor, food) {
  if (!actor || !food) return { actor, ok: false, reason: 'no-actor' };
  if (actor.hunger >= 98) return { actor, ok: false, reason: 'full' };
  return {
    actor: {
      ...actor,
      hunger: clamp100(actor.hunger + (food.hunger || 0)),
      energy: clamp100(actor.energy + (food.energy || 0)),
      mood: clamp100(actor.mood + (food.mood || 0)),
    },
    ok: true,
  };
}

/** 发工资：心情大幅提升。 */
export function applySalary(actor, now) {
  if (!actor) return { actor, ok: false };
  return { actor: { ...actor, mood: clamp100(actor.mood + SALARY_MOOD), hunger: clamp100(actor.hunger + 8), paidAt: now }, ok: true };
}

/** 抚摸（点击互动）：有冷却，成功返回新状态与粒子信号。 */
export function applyPet(actor, now) {
  if (!actor) return { actor, ok: false, reason: 'no-actor' };
  if (now - (actor.lastPetAt || 0) < PET_COOLDOWN_MS) return { actor, ok: false, reason: 'cooldown' };
  return { actor: { ...actor, mood: clamp100(actor.mood + PET_MOOD), lastPetAt: now }, ok: true };
}

/** 逗趣（再次点击已冷却中的小人）：小概率有效，无论成败都有反应（宠物游戏手感） */
export function applyPlay(actor, now) {
  if (!actor) return { actor, ok: false, reason: 'no-actor' };
  return { actor: { ...actor, energy: clamp100(actor.energy - 2), mood: clamp100(actor.mood + 3), lastPetAt: now }, ok: true };
}

/** 状态文案（气泡用） */
export function statWarningText(kind) {
  if (kind === 'hungry') return '肚子饿了…';
  if (kind === 'tired') return '好累，想休息…';
  if (kind === 'sad') return '心情有点低落…';
  return '';
}

/** 午休彩蛋窗口：11:30–13:30（本地时间） */
export function isLunchTime(now = Date.now()) {
  const d = new Date(now);
  const minutes = d.getHours() * 60 + d.getMinutes();
  return minutes >= 11 * 60 + 30 && minutes < 13 * 60 + 30;
}

/* ---------- 自主行动（v26.6）---------- */

/** 漫步边界（地板区域百分比） */
export const WANDER_BOUNDS = { minX: 8, maxX: 90, minY: 34, maxY: 88 };
/** 漫步走位时长（与 .ogame-unit 的 left/top 过渡时长一致） */
export const WANDER_WALK_MS = 1300;

/** 场景兴趣点：饮水机/绿植/沙发/电视/门口等，人爱往这些地方凑 */
export const SCENE_POIS = {
  office: [
    { x: 6, y: 42 },   // 饮水机
    { x: 33, y: 52 },  // 左绿植
    { x: 96, y: 34 },  // 右上绿植
    { x: 50, y: 62 },  // 地毯中央
    { x: 88, y: 28 },  // 门口
    { x: 14, y: 76 },  // 墙角
  ],
  lounge: [
    { x: 14, y: 60 },  // 沙发 A
    { x: 84, y: 72 },  // 沙发 B
    { x: 50, y: 40 },  // 电视前
    { x: 90, y: 52 },  // 饮水机
    { x: 30, y: 84 },  // 绿植边
  ],
};

/** 摸鱼闲聊气泡（到达兴趣点时小概率冒一句） */
export const AMBIENT_LINES = ['伸个懒腰~', '喝口水', '到处走走', '看看窗外的云', '脑子转转', '摸会儿鱼…', '这盆绿植真精神'];

/**
 * 自主漫步目标决策：60% 走向场景兴趣点（带抖动），40% 随机散步。
 * 纯函数：rng 注入可测试。
 * @returns {{ x: number, y: number, stayMs: number }}
 */
export function pickWanderTarget(scene, rng = Math.random) {
  const pois = SCENE_POIS[scene] || SCENE_POIS.office;
  let x;
  let y;
  if (rng() < 0.6) {
    const p = pois[Math.floor(rng() * pois.length)];
    x = p.x + (rng() - 0.5) * 10;
    y = p.y + (rng() - 0.5) * 8;
  } else {
    x = WANDER_BOUNDS.minX + rng() * (WANDER_BOUNDS.maxX - WANDER_BOUNDS.minX);
    y = WANDER_BOUNDS.minY + rng() * (WANDER_BOUNDS.maxY - WANDER_BOUNDS.minY);
  }
  x = Math.round(Math.max(WANDER_BOUNDS.minX, Math.min(WANDER_BOUNDS.maxX, x)) * 10) / 10;
  y = Math.round(Math.max(WANDER_BOUNDS.minY, Math.min(WANDER_BOUNDS.maxY, y)) * 10) / 10;
  return { x, y, stayMs: 3500 + Math.round(rng() * 6500) }; // 停留 3.5~10s 再走
}
