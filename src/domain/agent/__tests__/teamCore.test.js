import { describe, it, expect } from 'vitest';
import {
  normalizeTeamPlan,
  applyTaskStatusTransition,
  canUpdateTask,
  buildTeamMessage,
  buildSharedTaskListText,
  buildMailboxText,
  formatTeamDigest,
  TEAM_LIMITS,
} from '../teamCore.js';

// 模拟 preset（与 subagentCore.SUBAGENT_PRESETS 同形）
const preset = (id) => ({ id, name: id, systemPrompt: `${id} role prompt`, tools: [], maxTurns: 6 });
const getPreset = (id) => (['explorer', 'researcher', 'writer', 'critic'].includes(id) ? preset(id) : null);

const validPlan = () => normalizeTeamPlan({
  goal: '完成季度情报综述',
  teammates: [
    { name: '侦察兵', agent: 'explorer', objective: '收集原始素材' },
    { name: '主笔', agent: 'writer', objective: '起草综述' },
  ],
}, { getPreset });

describe('normalizeTeamPlan（组队契约）', () => {
  it('合法计划生成任务卡（owner 指定）', () => {
    const { plan, errors } = validPlan();
    expect(errors).toEqual([]);
    expect(plan.teamId).toMatch(/^team_/);
    expect(plan.teammates.length).toBe(2);
    expect(plan.tasks.length).toBe(2);
    expect(plan.tasks[0].owner).toBe('侦察兵');
    expect(plan.tasks[0].status).toBe('pending');
  });

  it('goal 缺失 / 成员不足 / 重复名 / 非法角色 / 空 objective 各自报错', () => {
    const r1 = normalizeTeamPlan({ goal: '', teammates: [{ name: 'a', agent: 'explorer', objective: 'x' }] }, { getPreset });
    expect(r1.plan).toBeNull();
    expect(r1.errors.some(e => e.includes('goal'))).toBe(true);

    const r2 = normalizeTeamPlan({ goal: 'g', teammates: [{ name: 'a', agent: 'explorer', objective: 'x' }] }, { getPreset });
    expect(r2.errors.some(e => e.includes('至少'))).toBe(true);

    const r3 = normalizeTeamPlan({
      goal: 'g',
      teammates: [
        { name: 'a', agent: 'explorer', objective: 'x' },
        { name: 'a', agent: 'writer', objective: 'y' },
      ],
    }, { getPreset });
    expect(r3.errors.some(e => e.includes('重复'))).toBe(true);

    const r4 = normalizeTeamPlan({
      goal: 'g',
      teammates: [
        { name: 'a', agent: 'explorer', objective: 'x' },
        { name: 'b', agent: 'nope', objective: 'y' },
      ],
    }, { getPreset });
    expect(r4.errors.some(e => e.includes('nope'))).toBe(true);

    const r5 = normalizeTeamPlan({
      goal: 'g',
      teammates: [
        { name: 'a', agent: 'explorer', objective: 'x' },
        { name: 'b', agent: 'writer', objective: '' },
      ],
    }, { getPreset });
    expect(r5.errors.some(e => e.includes('objective'))).toBe(true);
  });

  it('成员超上限报错', () => {
    const teammates = Array.from({ length: TEAM_LIMITS.MAX_TEAMMATES + 1 }, (_, i) => ({ name: `m${i}`, agent: 'explorer', objective: `t${i}` }));
    const r = normalizeTeamPlan({ goal: 'g', teammates }, { getPreset });
    expect(r.errors.some(e => e.includes('上限'))).toBe(true);
  });
});

describe('applyTaskStatusTransition（任务状态机）', () => {
  const task = { id: 't1', title: 'T', owner: 'a', status: 'pending', result: '' };

  it('合法推进：pending → in_progress → done（记录结果）', () => {
    const r1 = applyTaskStatusTransition(task, 'in_progress', { by: 'a' });
    expect(r1.ok).toBe(true);
    expect(r1.task.status).toBe('in_progress');
    const r2 = applyTaskStatusTransition(r1.task, 'done', { by: 'a', result: '写完了' });
    expect(r2.ok).toBe(true);
    expect(r2.task.status).toBe('done');
    expect(r2.task.result).toBe('写完了');
  });

  it('非法跳级与回退被拒绝', () => {
    expect(applyTaskStatusTransition(task, 'done').ok).toBe(false); // pending → done 跳级
    const started = applyTaskStatusTransition(task, 'in_progress', { by: 'a' }).task;
    expect(applyTaskStatusTransition(started, 'pending').ok).toBe(false); // 回退
    expect(applyTaskStatusTransition(started, 'in_progress').ok).toBe(false); // 重复
  });

  it('非法状态值拒绝；未知任务拒绝', () => {
    expect(applyTaskStatusTransition(task, 'canceled').ok).toBe(false);
    expect(applyTaskStatusTransition(null, 'done').ok).toBe(false);
  });
});

describe('canUpdateTask（owner 鉴权）', () => {
  it('owner 可更新，他人不可，lead 越权放行', () => {
    const task = { owner: 'a' };
    expect(canUpdateTask(task, 'a')).toBe(true);
    expect(canUpdateTask(task, 'b')).toBe(false);
    expect(canUpdateTask(task, 'b', true)).toBe(true); // lead 越权放行
  });
});

describe('buildTeamMessage / buildMailboxText（邮箱）', () => {
  it('消息结构完整；邮箱只含发给自己与广播的消息', () => {
    const msg = buildTeamMessage({ teamId: 't1', from: '侦察兵', to: '主笔', body: '材料在这' });
    expect(msg.from).toBe('侦察兵');
    expect(msg.to).toBe('主笔');
    expect(msg.body).toBe('材料在这');

    const team = {
      messages: [
        buildTeamMessage({ teamId: 't1', from: '侦察兵', to: '主笔', body: '给你' }),
        buildTeamMessage({ teamId: 't1', from: '主笔', to: 'lead', body: '报告 lead' }),
        buildTeamMessage({ teamId: 't1', from: '侦察兵', to: '*', body: '广播' }),
      ],
    };
    const forWriter = buildMailboxText(team, '主笔');
    expect(forWriter).toContain('给你');
    expect(forWriter).toContain('广播');
    expect(forWriter).not.toContain('报告 lead');

    const forLead = buildMailboxText(team, 'lead');
    expect(forLead).toContain('报告 lead');
  });
});

describe('buildSharedTaskListText（看板文本）', () => {
  it('渲染全部任务与协作规则', () => {
    const { plan } = validPlan();
    const team = { goal: plan.goal, tasks: plan.tasks };
    const text = buildSharedTaskListText(team);
    expect(text).toContain('共享任务列表');
    expect(text).toContain('@侦察兵');
    expect(text).toContain('[待认领]');
    expect(text).toContain('update_team_task');
  });
});

describe('formatTeamDigest（lead 摘要）', () => {
  it('统计 + 任务板 + 成员报告', () => {
    const { plan } = validPlan();
    const team = {
      goal: plan.goal,
      teammates: plan.teammates,
      tasks: plan.tasks.map((t, i) => ({ ...t, status: i === 0 ? 'done' : 'in_progress', result: i === 0 ? '素材 12 条' : '' })),
      messages: [buildTeamMessage({ teamId: 't', from: 'a', to: 'b', body: 'hi' })],
    };
    const digest = formatTeamDigest(team, [
      { memberName: '侦察兵', agentName: '探索者', status: 'done', report: '侦察完成：发现 12 条素材' },
      { memberName: '主笔', agentName: '撰写者', status: 'aborted', error: '被中止' },
    ]);
    expect(digest).toContain('完成 1 / 失败 0');
    expect(digest).toContain('素材 12 条');
    expect(digest).toContain('侦察完成');
    expect(digest).toContain('未完成');
  });
});
