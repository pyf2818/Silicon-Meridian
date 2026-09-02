import { describe, it, expect } from 'vitest';
import {
  SUBAGENT_PRESETS,
  listSubagentIds,
  getSubagentPreset,
  normalizeSpawnTasks,
  buildSubagentSystemPrompt,
  buildTaskBriefMessage,
  createBudget,
  aggregateSpawnReports,
  formatSubagentReport,
  SUBAGENT_LIMITS,
} from '../subagentCore.js';

describe('SUBAGENT_PRESETS（预置子代理）', () => {
  it('包含四个预置且 id 唯一', () => {
    expect(SUBAGENT_PRESETS.length).toBe(4);
    const ids = SUBAGENT_PRESETS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['explorer', 'researcher', 'writer', 'critic']);
  });

  it('每个 preset 结构完整且 maxTurns 有上限', () => {
    for (const p of SUBAGENT_PRESETS) {
      expect(p.name).toBeTruthy();
      expect(p.systemPrompt.length).toBeGreaterThan(20);
      expect(Array.isArray(p.tools)).toBe(true);
      expect(p.maxTurns).toBeGreaterThanOrEqual(3);
      expect(p.maxTurns).toBeLessThanOrEqual(12);
    }
  });

  it('工具白名单是继承收缩：不含 spawn_subagent（深度物理隔离）', () => {
    for (const p of SUBAGENT_PRESETS) {
      expect(p.tools).not.toContain('spawn_subagent');
    }
  });

  it('writer 才有写权限，explorer/researcher/critic 全只读', () => {
    const writer = getSubagentPreset('writer');
    expect(writer.tools).toContain('write_workspace_file');
    for (const id of ['explorer', 'researcher', 'critic']) {
      expect(getSubagentPreset(id).tools).not.toContain('write_workspace_file');
      expect(getSubagentPreset(id).tools).not.toContain('edit_file');
    }
  });

  it('getSubagentPreset 未知 id 返回 null；listSubagentIds 供 schema enum', () => {
    expect(getSubagentPreset('nonexistent')).toBeNull();
    expect(getSubagentPreset('')).toBeNull();
    expect(listSubagentIds()).toContain('researcher');
  });
});

describe('normalizeSpawnTasks（spawn 契约校验）', () => {
  it('合法任务规范化并通过', () => {
    const { tasks, errors } = normalizeSpawnTasks([
      { agent: 'explorer', objective: '侦察今日 AI 资讯', context: '背景材料', constraints: '只看国内源', output_format: '列表' },
      { agent: 'researcher', objective: '深度调研 Agent 编排' },
    ]);
    expect(errors).toEqual([]);
    expect(tasks.length).toBe(2);
    expect(tasks[0].preset.id).toBe('explorer');
    expect(tasks[0].outputFormat).toBe('列表'); // output_format → outputFormat
    expect(tasks[0].id).toMatch(/^sub_/);
    expect(tasks[0].index).toBe(0);
  });

  it('非法 agent 与空 objective 报错', () => {
    const { tasks, errors } = normalizeSpawnTasks([
      { agent: 'hacker', objective: 'x' },
      { agent: 'writer', objective: '' },
      { agent: 'writer' },
    ]);
    expect(tasks.length).toBe(0);
    expect(errors.length).toBe(3);
    expect(errors[0]).toContain('hacker');
    expect(errors[1]).toContain('objective');
  });

  it('超上限截取并告警', () => {
    const raw = Array.from({ length: 8 }, (_, i) => ({ agent: 'explorer', objective: `任务 ${i}` }));
    const { tasks, errors } = normalizeSpawnTasks(raw);
    expect(tasks.length).toBe(SUBAGENT_LIMITS.MAX_TASKS_PER_SPAWN);
    expect(errors.some(e => e.includes('超过单次上限'))).toBe(true);
  });

  it('非数组输入返回结构化错误', () => {
    expect(normalizeSpawnTasks(null).errors.length).toBe(1);
    expect(normalizeSpawnTasks([]).errors.length).toBe(1);
  });
});

describe('buildSubagentSystemPrompt（隔离上下文构造）', () => {
  const task = normalizeSpawnTasks([{ agent: 'researcher', objective: '调研 X', context: '背景 C', constraints: '约束 K', output_format: '表格' }]).tasks[0];

  it('包含角色设定与任务简报，不携带主对话', () => {
    const sp = buildSubagentSystemPrompt(task, {});
    expect(sp).toContain(task.preset.systemPrompt.slice(0, 30));
    expect(sp).toContain('子代理');
    expect(sp).toContain('调研 X');
    expect(sp).toContain('背景 C');
    expect(sp).toContain('约束 K');
    expect(sp).toContain('表格');
  });

  it('无 output_format 时给默认报告结构；含边界声明', () => {
    const t2 = normalizeSpawnTasks([{ agent: 'explorer', objective: 'Y' }]).tasks[0];
    const sp = buildSubagentSystemPrompt(t2, {});
    expect(sp).toContain('结论 → 关键发现');
    expect(sp).toContain('不再派生其他代理');
  });
});

describe('buildTaskBriefMessage', () => {
  it('user 消息携带任务目标', () => {
    const task = normalizeSpawnTasks([{ agent: 'critic', objective: '审阅报告 R' }]).tasks[0];
    const msg = buildTaskBriefMessage(task);
    expect(msg.role).toBe('user');
    expect(msg.content).toContain('审阅报告 R');
  });
});

describe('createBudget（预算）', () => {
  it('consume 累计 token 与轮数，exceeded 判定', () => {
    const b = createBudget({ maxTurns: 3, maxTokens: 1000 });
    expect(b.exceeded()).toBe(false);
    b.consume({ total_tokens: 400 }, 1);
    b.consume({ total_tokens: 300 }, 2);
    expect(b.spentTokens).toBe(700);
    expect(b.exceeded()).toBe(false);
    b.consume({ total_tokens: 400 }, 3);
    expect(b.exceeded()).toBe(true); // 轮数超限
  });

  it('token 预算独立生效', () => {
    const b = createBudget({ maxTurns: 10, maxTokens: 500 });
    b.consume({ total_tokens: 600 }, 1);
    expect(b.exceeded()).toBe(true);
  });
});

describe('aggregateSpawnReports（结果聚合）', () => {
  const base = { id: 's1', usage: { total_tokens: 500 }, turns: 4, transcriptPath: 'outputs/subagents/x.md' };

  it('成功与失败混合时输出统计 + 各报告 + 失败原因', () => {
    const out = aggregateSpawnReports([
      { ...base, agent: 'explorer', agentName: '探索者', objective: '侦察 A', status: 'done', report: '发现 1、发现 2' },
      { ...base, agent: 'writer', agentName: '撰写者', objective: '起草 B', status: 'failed', error: '上游 429' },
    ]);
    expect(out).toContain('成功 1，失败 1');
    expect(out).toContain('合计消耗 1000 tokens');
    expect(out).toContain('发现 1、发现 2');
    expect(out).toContain('未产出报告：上游 429');
  });

  it('报告被截断到 12000 字符（防撑爆 orchestrator 上下文）', () => {
    const out = formatSubagentReport({
      ...base, agent: 'researcher', agentName: '研究员', objective: '深研', status: 'done',
      report: 'x'.repeat(50_000),
    });
    expect(out.length).toBeLessThan(50_000);
    expect(out).toContain('transcript=');
  });
});
