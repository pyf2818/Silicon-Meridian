/**
 * officeScene.test.js - 像素办公室纯逻辑单测（v26 #15）
 * 覆盖：状态推导（running/phase/时间窗衰减）/ 事件流（游标过滤、气泡文本、上限）
 */
import { describe, it, expect } from 'vitest';
import {
  deriveOfficeActivity, deriveOfficeEvents, OFFICE_STATUS_LABEL,
} from '../officeScene.js';

const NOW = 1_000_000;
const AGENT_A = 'scout';
const AGENT_B = 'writer';

function msg(partial) {
  return { role: 'agent', agentId: AGENT_A, at: NOW, status: 'done', content: '', meta: {}, ...partial };
}

describe('deriveOfficeActivity 状态推导', () => {
  it('无消息 → 全员空闲', () => {
    const out = deriveOfficeActivity([], [AGENT_A, AGENT_B], NOW);
    expect(out.map(o => o.status)).toEqual(['idle', 'idle']);
  });

  it('running 占位：work 阶段=执行中，claim 阶段=思考中', () => {
    const msgs = [
      msg({ agentId: AGENT_A, status: 'running', meta: { phase: 'work' } }),
      msg({ agentId: AGENT_B, status: 'running', meta: { phase: 'claim' } }),
    ];
    const out = deriveOfficeActivity(msgs, [AGENT_A, AGENT_B], NOW);
    expect(out[0].status).toBe('working');
    expect(out[1].status).toBe('claiming');
  });

  it('刚交付的 work（3 分钟内）= 已交付；超窗回落空闲', () => {
    const fresh = deriveOfficeActivity(
      [msg({ meta: { phase: 'work' }, at: NOW - 60_000 })],
      [AGENT_A], NOW,
    );
    expect(fresh[0].status).toBe('done');
    const stale = deriveOfficeActivity(
      [msg({ meta: { phase: 'work' }, at: NOW - 10 * 60_000 })],
      [AGENT_A], NOW,
    );
    expect(stale[0].status).toBe('idle');
  });

  it('刚认领（claim kind）= 已认领；关注/旁观不视为认领', () => {
    const claimed = deriveOfficeActivity(
      [msg({ meta: { phase: 'claim', kind: 'claim' }, at: NOW - 30_000 })],
      [AGENT_A], NOW,
    );
    expect(claimed[0].status).toBe('claimed');
    const watching = deriveOfficeActivity(
      [msg({ meta: { phase: 'claim', kind: 'watch' }, at: NOW - 30_000 })],
      [AGENT_A], NOW,
    );
    expect(watching[0].status).toBe('idle');
  });

  it('只看每个成员最新一条消息（旧状态被新状态覆盖）', () => {
    const msgs = [
      msg({ meta: { phase: 'work' }, at: NOW - 10_000 }),          // 旧的已交付
      msg({ status: 'running', meta: { phase: 'work' }, at: NOW }), // 最新的执行中
    ];
    const out = deriveOfficeActivity(msgs, [AGENT_A], NOW);
    expect(out[0].status).toBe('working');
  });

  it('未来时间戳（时钟偏差）不崩溃、按空闲处理窗口', () => {
    const out = deriveOfficeActivity([msg({ at: NOW + 60_000, meta: { phase: 'work' } })], [AGENT_A], NOW);
    expect(['idle', 'done']).toContain(out[0].status);
  });
});

describe('deriveOfficeEvents 事件流', () => {
  it('只返回游标之后的新事件，正序排列', () => {
    const msgs = [
      msg({ agentId: AGENT_A, at: NOW - 5000, meta: { phase: 'claim', kind: 'claim' }, content: '【认领】' }),
      { role: 'user', at: NOW - 3000, content: '大家查一下' },
      msg({ agentId: AGENT_A, at: NOW - 1000, meta: { phase: 'work' }, content: '报告…' }),
    ];
    const events = deriveOfficeEvents(msgs, NOW - 6000, NOW);
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ agentId: AGENT_A, text: '认领了任务' });
    expect(events[1]).toMatchObject({ agentId: '_founder', text: '大家查一下' });
    expect(events[2]).toMatchObject({ agentId: AGENT_A, text: '交付了产出' });
  });

  it('running 占位与系统行不产生事件；limit 截断保留最新', () => {
    const msgs = [
      { role: 'system', at: NOW - 4000, content: '系统行' },
      msg({ status: 'running', at: NOW - 3000, meta: { phase: 'work' } }),
      msg({ agentId: AGENT_A, at: NOW - 2000, meta: { phase: 'claim', kind: 'watch' }, content: '【关注】' }),
      msg({ agentId: AGENT_A, at: NOW - 1000, meta: { phase: 'claim', kind: 'claim' }, content: '【认领】' }),
    ];
    const events = deriveOfficeEvents(msgs, 0, NOW, 1);
    expect(events).toHaveLength(1);
    expect(events[0].text).toBe('认领了任务');
  });
});

describe('OFFICE_STATUS_LABEL', () => {
  it('五种状态都有中文标签', () => {
    expect(Object.keys(OFFICE_STATUS_LABEL)).toHaveLength(5);
    expect(OFFICE_STATUS_LABEL.working).toBe('执行中');
  });
});
