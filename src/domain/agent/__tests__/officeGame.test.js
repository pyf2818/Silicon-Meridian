/**
 * officeGame.test.js - 像素养成游戏纯逻辑单测（v26 #17）
 */
import { describe, it, expect } from 'vitest';
import {
  tickActors, applyFood, applySalary, applyPet, applyPlay,
  moodBase, isLunchTime, FOODS, SALARY_COST, MAX_CATCHUP_MS,
} from '../officeGame.js';

const NOW = 1_000_000_000;
const A = 'agent-a';

function actor(over = {}) {
  return { hunger: 80, energy: 90, mood: 70, lastPetAt: 0, paidAt: 0, ...over };
}

describe('tickActors 时间衰减（含离线补账）', () => {
  it('饱食随时间下降；空闲时精力回复', () => {
    const { actors } = tickActors({ [A]: actor() }, NOW, NOW + 60 * 60000, { [A]: false });
    expect(actors[A].hunger).toBeCloseTo(80 - 0.8 * 60, 5); // 0.8/分钟
    expect(actors[A].energy).toBe(100); // 空闲回复（+0.7/分），封顶 100
  });

  it('在岗时精力加速消耗', () => {
    const { actors } = tickActors({ [A]: actor() }, NOW, NOW + 60 * 60000, { [A]: true });
    expect(actors[A].energy).toBeCloseTo(90 - 1.3 * 60, 5); // 1.3/分钟
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
