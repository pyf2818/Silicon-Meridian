/**
 * officeGame.test.js - 像素养成游戏纯逻辑单测（v26 #17）
 */
import { describe, it, expect } from 'vitest';
import {
  tickActors, applyFood, applySalary, applyPet, applyPlay,
  moodBase, isLunchTime, FOODS, SALARY_COST, MAX_CATCHUP_MS,
  accrueStipend, STIPEND_AMOUNT, STIPEND_INTERVAL_MS,
  pickWanderTarget, WANDER_BOUNDS, SCENE_POIS,
  sceneComfort, FURNITURE, MAX_FURNITURE_PER_SCENE,
  resolveActorScene, REST_SPOTS, pickRestSpot, walkDurationMs,
} from '../officeGame.js';

const NOW = 1_000_000_000;
const A = 'agent-a';

function actor(over = {}) {
  return { hunger: 80, energy: 90, mood: 70, lastPetAt: 0, paidAt: 0, ...over };
}

describe('tickActors 时间衰减（含离线补账）', () => {
  it('饱食随时间下降；空闲时精力回复', () => {
    const { actors } = tickActors({ [A]: actor() }, NOW, NOW + 60 * 60000, { [A]: false });
    expect(actors[A].hunger).toBeCloseTo(80 - 0.45 * 60, 5); // 0.45/分钟
    expect(actors[A].energy).toBe(100); // 空闲回复（+0.5/分），封顶 100
  });

  it('在岗时精力加速消耗', () => {
    const { actors } = tickActors({ [A]: actor() }, NOW, NOW + 60 * 60000, { [A]: true });
    expect(actors[A].energy).toBeCloseTo(90 - 0.9 * 60, 5); // 0.9/分钟
  });

  it('离线补账：elapsed 封顶 24h，不会把属性打成负数', () => {
    const { actors } = tickActors({ [A]: actor() }, NOW - 10 * MAX_CATCHUP_MS, NOW, {});
    expect(actors[A].hunger).toBe(0);
    expect(actors[A].mood).toBeGreaterThanOrEqual(0);
  });

  it('心情向基础值漂移（不吃不喝会慢慢变差）', () => {
    const start = actor({ hunger: 10, energy: 10, mood: 80 });
    const { actors } = tickActors({ [A]: start }, NOW, NOW + 120 * 60000, {});
    expect(actors[A].mood).toBeLessThan(80);
    expect(actors[A].mood).toBeGreaterThanOrEqual(moodBase(actors[A], false) - 1);
  });

  it('跨越警戒线产生一次性警告', () => {
    const start = actor({ hunger: 21 });
    const { warnings } = tickActors({ [A]: start }, NOW, NOW + 10 * 60000, {});
    expect(warnings.some(w => w.agentId === A && w.kind === 'hungry')).toBe(true);
    // 已在警戒线下再结算：不再报警
    const again = tickActors({ [A]: actor({ hunger: 15 }) }, NOW, NOW + 60000, {});
    expect(again.warnings.some(w => w.kind === 'hungry')).toBe(false);
  });
});

describe('投喂 / 工资 / 抚摸 / 逗趣', () => {
  it('投喂恢复饱食与心情；全饱拒食', () => {
    const fed = applyFood(actor({ hunger: 50 }), FOODS.riceball);
    expect(fed.ok).toBe(true);
    expect(fed.actor.hunger).toBe(80);
    const refuse = applyFood(actor({ hunger: 99 }), FOODS.riceball);
    expect(refuse.ok).toBe(false);
    expect(refuse.reason).toBe('full');
  });

  it('投喂属性封顶 100', () => {
    const fed = applyFood(actor({ hunger: 95, energy: 99 }), FOODS.riceball);
    expect(fed.actor.hunger).toBe(100);
    expect(fed.actor.energy).toBe(100);
  });

  it('发工资：心情 +30 并记录 paidAt', () => {
    const res = applySalary(actor({ mood: 50 }), NOW);
    expect(res.ok).toBe(true);
    expect(res.actor.mood).toBe(80);
    expect(res.actor.paidAt).toBe(NOW);
  });

  it('抚摸：心情 +6 且有 3 秒冷却；冷却中逗趣 +3 心情 -2 精力', () => {
    const pet = applyPet(actor({ mood: 50 }), NOW);
    expect(pet.ok).toBe(true);
    expect(pet.actor.mood).toBe(56);
    const again = applyPet(pet.actor, NOW + 1000);
    expect(again.ok).toBe(false);
    expect(again.reason).toBe('cooldown');
    const play = applyPlay(pet.actor, NOW + 1000);
    expect(play.ok).toBe(true);
    expect(play.actor.mood).toBe(59);
    expect(play.actor.energy).toBe(88); // 90 - 2
  });
});

describe('moodBase 基础值与午休窗口', () => {
  it('饱食精力满 → 基础值高；空 → 低', () => {
    const high = moodBase(actor({ hunger: 100, energy: 100 }), false);
    const low = moodBase(actor({ hunger: 0, energy: 0 }), false);
    expect(high).toBeGreaterThan(low);
    expect(high).toBeLessThanOrEqual(100);
  });

  it('午休窗口：11:30–13:30 为真', () => {
    const at = (h, m) => new Date(2026, 8, 10, h, m).getTime();
    expect(isLunchTime(at(12, 0))).toBe(true);
    expect(isLunchTime(at(11, 30))).toBe(true);
    expect(isLunchTime(at(13, 29))).toBe(true);
    expect(isLunchTime(at(10, 0))).toBe(false);
    expect(isLunchTime(at(14, 0))).toBe(false);
  });

  it('常量自洽：工资成本与产出奖励构成经济闭环', () => {
    expect(SALARY_COST).toBeGreaterThan(0);
    expect(FOODS.riceball.cost).toBeGreaterThan(0);
  });
});

describe('v26.6 经济平衡：团队补贴', () => {
  it('不足一拍不入账', () => {
    const r = accrueStipend(100, NOW, NOW + STIPEND_INTERVAL_MS - 1);
    expect(r.coins).toBe(100);
    expect(r.gained).toBe(0);
  });

  it('整拍入账，且按 lastStipendAt 推进不重复计费', () => {
    const r1 = accrueStipend(100, NOW, NOW + STIPEND_INTERVAL_MS * 2.5);
    expect(r1.gained).toBe(STIPEND_AMOUNT * 2);
    expect(r1.coins).toBe(100 + STIPEND_AMOUNT * 2);
    // 用推进后的锚点再算：剩余半拍不重复入账
    const r2 = accrueStipend(r1.coins, r1.lastStipendAt, NOW + STIPEND_INTERVAL_MS * 2.5);
    expect(r2.gained).toBe(0);
  });

  it('离线补账封顶 24h，不会无限入账', () => {
    const r = accrueStipend(0, NOW - 100 * MAX_CATCHUP_MS, NOW);
    expect(r.gained).toBe(STIPEND_AMOUNT * Math.floor(MAX_CATCHUP_MS / STIPEND_INTERVAL_MS));
  });
});

describe('v26.6 自主行动：pickWanderTarget', () => {
  it('目标始终落在场景边界内', () => {
    for (let i = 0; i < 200; i++) {
      const t = pickWanderTarget(i % 2 === 0 ? 'office' : 'lounge');
      expect(t.x).toBeGreaterThanOrEqual(WANDER_BOUNDS.minX);
      expect(t.x).toBeLessThanOrEqual(WANDER_BOUNDS.maxX);
      expect(t.y).toBeGreaterThanOrEqual(WANDER_BOUNDS.minY);
      expect(t.y).toBeLessThanOrEqual(WANDER_BOUNDS.maxY);
      expect(t.stayMs).toBeGreaterThanOrEqual(3500);
      expect(t.stayMs).toBeLessThanOrEqual(10000);
    }
  });

  it('兴趣点模式：rng 恒 0 时落在第一个 POI 附近（带抖动不越界）', () => {
    const t = pickWanderTarget('office', () => 0);
    const p0 = SCENE_POIS.office[0];
    expect(Math.abs(t.x - p0.x)).toBeLessThanOrEqual(5);
    expect(Math.abs(t.y - p0.y)).toBeLessThanOrEqual(4);
  });

  it('随机模式：rng 恒 0.99 时落在边界附近', () => {
    const t = pickWanderTarget('office', () => 0.99);
    expect(t.x).toBeGreaterThan(WANDER_BOUNDS.maxX - 3);
  });
});

describe('v26.6 家具舒适度', () => {
  it('每件 +2，封顶 12', () => {
    expect(sceneComfort([])).toBe(0);
    expect(sceneComfort([{}, {}])).toBe(4);
    expect(sceneComfort(Array(MAX_FURNITURE_PER_SCENE).fill({}))).toBe(12);
    expect(sceneComfort(Array(20).fill({}))).toBe(12);
  });

  it('舒适度提升心情基础值', () => {
    const base = moodBase(actor(), false);
    expect(moodBase(actor(), false, 10)).toBe(Math.min(100, base + 10));
  });

  it('家具目录：价格递增、目录与摆放上限自洽', () => {
    const costs = Object.values(FURNITURE).map(f => f.cost);
    expect(costs.every(c => c > 0)).toBe(true);
    expect(MAX_FURNITURE_PER_SCENE).toBeGreaterThan(0);
  });
});

describe('v26.7 休息逻辑：场景随状态驱动', () => {
  it('在岗/认领/刚交付 → 办公室；空闲 → 休息区', () => {
    expect(resolveActorScene('working')).toBe('office');
    expect(resolveActorScene('claiming')).toBe('office');
    expect(resolveActorScene('claimed')).toBe('office');
    expect(resolveActorScene('done')).toBe('office');
    expect(resolveActorScene('idle')).toBe('lounge');
    expect(resolveActorScene(undefined)).toBe('lounge');
  });

  it('休息位：按序号循环分配，落在边界内且围绕锚点抖动', () => {
    expect(REST_SPOTS.length).toBeGreaterThanOrEqual(2);
    const a = pickRestSpot(0, () => 0.5);
    expect(a.x).toBeCloseTo(REST_SPOTS[0].x, 1);
    for (let i = 0; i < 50; i++) {
      const s = pickRestSpot(i);
      expect(s.x).toBeGreaterThanOrEqual(WANDER_BOUNDS.minX);
      expect(s.x).toBeLessThanOrEqual(WANDER_BOUNDS.maxX);
      expect(s.y).toBeGreaterThanOrEqual(WANDER_BOUNDS.minY);
      expect(s.y).toBeLessThanOrEqual(WANDER_BOUNDS.maxY);
    }
  });
});

describe('v26.7 平滑步行：恒定步速时长', () => {
  it('时长随距离伸缩，短步 0.9s 下限、长步 4s 封顶', () => {
    expect(walkDurationMs(0, 0, 5, 0)).toBe(900);      // 5% → 500ms → 下限 900
    expect(walkDurationMs(0, 0, 20, 0)).toBe(2000);    // 20% @10%/s
    expect(walkDurationMs(0, 0, 90, 60)).toBe(4000);   // 108% → 封顶
  });

  it('长距离耗时严格大于短距离（连续移动，无瞬移）', () => {
    expect(walkDurationMs(10, 40, 80, 40)).toBeGreaterThan(walkDurationMs(10, 40, 30, 40));
  });
});
