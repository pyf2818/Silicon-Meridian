/**
 * agentTeamTools.js - Agent Team 工具注册（import 即注册）
 *
 * spawn_agent_team：lead（主 agent）组建团队 → 共享任务列表（teamStore）→
 * 队友并行常驻执行（各自 runToolLoop），运行中通过 update_team_task 推进任务板、
 * post_team_message 互通消息（邮箱快照每轮注入队友 system prompt——真实共享状态，
 * 而非静态 prompt 拷贝）→ 全部完结后 lead 收到团队摘要与各成员报告。
 *
 * 与 spawn_subagent 的分工：subagent = 一次性派活收报告；team = 成员间通过
 * 共享任务列表 + 邮箱协作、彼此可见进度（对标 Claude Code agent teams 的
 * shared task list + inter-agent messaging）。
 *
 * 安全边界：team 工具只写本地 localStorage 任务板（低风险、免审批）；跨团队写入
 * 用 ctx.__teamId 绑定阻断；任务状态机（pending→in_progress→done/failed）由
 * teamCore.applyTaskStatusTransition 强制；非 owner 不能更新他人任务。
 */

import { registerTool } from './toolRegistry.js';
import { getSubagentPreset, SUBAGENT_LIMITS } from '../domain/agent/subagentCore.js';
import {
  normalizeTeamPlan,
  applyTaskStatusTransition,
  canUpdateTask,
  buildTeamMessage,
  buildSharedTaskListText,
  formatTeamDigest,
} from '../domain/agent/teamCore.js';
import { createTeam, updateTeamTask, postTeamMessage, getTeam, finishTeam } from '../store/teamStore.js';
import { runSubagentTasks } from '../components/aichat/subagentRunner.js';

const TEAM_TIMEOUT_MS = 1_200_000; // 团队全流程窗口（多成员 × 多轮）

/* ==================== 队友协作工具（注入队友白名单） ==================== */

async function toolUpdateTeamTask(args, ctx) {
  const teamId = ctx?.__teamId || args?.team_id;
  const team = getTeam(teamId);
  if (!team) return '错误：找不到所属团队（上下文缺失），无法更新任务。';
  const taskId = String(args?.task_id || '');
  const task = team.tasks.find(t => t.id === taskId);
  if (!task) return `错误：任务 "${taskId}" 不存在。可用任务：${team.tasks.map(t => t.id).join('、')}`;
  if (!canUpdateTask(task, ctx?.teamMember)) {
    return `错误：任务 "${taskId}" 的 owner 是 @${task.owner}，你不能更新他人的任务。`;
  }
  const verdict = applyTaskStatusTransition(task, String(args?.status || ''), {
    by: ctx?.teamMember,
    result: args?.result,
  });
  if (!verdict.ok) return `错误：${verdict.error}`;
  updateTeamTask(teamId, taskId, verdict.task);
  return `任务 "${task.title}" 已更新为 ${verdict.task.status}。${verdict.task.result ? `结果已记录：${verdict.task.result.slice(0, 200)}` : ''}`;
}

async function toolPostTeamMessage(args, ctx) {
  const teamId = ctx?.__teamId || args?.team_id;
  const team = getTeam(teamId);
  if (!team) return '错误：找不到所属团队（上下文缺失），无法发送消息。';
  const body = String(args?.body || '').trim();
  if (!body) return '错误：消息内容不能为空。';
  const to = String(args?.to || 'lead').trim();
  const memberNames = team.teammates.map(m => m.name);
  if (to !== 'lead' && to !== '*' && !memberNames.includes(to)) {
    return `错误：收件人 "${to}" 不存在（可用：lead / * / ${memberNames.join('、')}）`;
  }
  const msg = buildTeamMessage({ teamId, from: ctx?.teamMember || 'lead', to, body });
  postTeamMessage(teamId, msg);
  return `消息已投递给 @${to}。`;
}

/* ==================== lead 的组队工具 ==================== */

async function toolSpawnAgentTeam(args, ctx) {
  if (ctx?.__subagent) {
    return '错误：子代理不允许组建团队（编排深度限制 1 层）。请直接完成任务并输出报告。';
  }
  const { plan, errors } = normalizeTeamPlan(args, { getPreset: getSubagentPreset });
  if (!plan) {
    return `错误：spawn_agent_team 契约校验失败：\n- ${errors.join('\n- ')}\n请修正后重新调用。`;
  }
  createTeam(plan);
  const teamId = plan.teamId;

  try {
    // 队友任务 = 预置角色 + 个人任务卡 + 团队协作协议
    const memberTasks = plan.teammates.map((m, idx) => ({
      id: plan.tasks[idx].id,
      index: idx,
      preset: m.preset,
      objective: m.objective,
      context: m.context,
      constraints: [
        `你是团队「${plan.goal}」的成员 @${m.name}（任务 owner）。协作协议：开工先把你的任务卡标 in_progress；完成必须用 update_team_task 标 done 并附结果摘要；受阻标 failed 并说明原因。`,
        '需要配合或给 lead 留言用 post_team_message（to 可为 lead / * / 队友名）；留意每轮注入的【共享任务列表】与【团队邮箱】，响应其他成员的合理请求；不要重复他人任务范围内的劳动。',
        m.constraints,
      ].filter(Boolean).join('\n'),
      outputFormat: '最终回复 = 成员报告：① 我完成的任务与状态 ② 关键产出 ③ 移交/建议',
    }));

    // 进度快照：任务板 + 成员状态，推给团队卡片
    const memberStatus = plan.teammates.map((m, idx) => ({
      id: plan.tasks[idx].id,
      memberName: m.name,
      agentName: m.preset.name,
      objective: m.objective,
      status: 'pending',
      tokens: 0,
    }));
    const pushSnapshot = () => {
      const team = getTeam(teamId);
      try {
        ctx?.emitProgress?.({
          type: 'team',
          goal: plan.goal,
          tasks: (team?.tasks || []).map(t => ({ id: t.id, title: t.title, owner: t.owner, status: t.status, result: t.result })),
          members: memberStatus.map(m => ({ ...m })),
        });
      } catch { /* 进度失败不影响执行 */ }
    };

    const memberReports = await runSubagentTasks({
      tasks: memberTasks,
      llmConfig: ctx?.llmConfig,
      selectedModel: ctx?.llmConfig?.selectedModel,
      parentCtx: ctx,
      signal: ctx?.signal,
      concurrency: SUBAGENT_LIMITS.MAX_CONCURRENCY,
      // 队友白名单 = 角色白名单 + 团队协作工具
      extraTools: ['update_team_task', 'post_team_message'],
      // 每轮注入实时共享任务列表 + 个人邮箱（队友间真实感知）
      buildSystemSuffix: (task) => {
        const team = getTeam(teamId);
        if (!team) return '';
        const memberName = plan.teammates[task.index]?.name || '';
        const mailbox = (team.messages || [])
          .filter(msg => msg.to === memberName || msg.to === '*')
          .slice(-8)
          .map(msg => `- <team_message from="${msg.from}" to="${msg.to}">${msg.body}</team_message>`);
        return [
          buildSharedTaskListText(team),
          mailbox.length ? `【团队邮箱】收到的消息：\n${mailbox.join('\n')}` : '',
        ].filter(Boolean).join('\n\n');
      },
      // 每个队友绑定团队身份（team 工具据此鉴权）
      extraCtxFn: (task) => ({
        __teamId: teamId,
        teamMember: plan.teammates[task.index]?.name || '',
      }),
      onProgress: (taskIndex, patch) => {
        if (memberStatus[taskIndex]) Object.assign(memberStatus[taskIndex], patch);
        pushSnapshot();
      },
    });

    // 全部完结：落团队状态 + 生成 lead 摘要
    const allDone = memberReports.every(r => r.status === 'done');
    const team = finishTeam(teamId, allDone ? 'completed' : 'partial');
    let out = formatTeamDigest(team, memberReports.map((r, idx) => ({ ...r, memberName: plan.teammates[idx]?.name || r.memberName })));
    if (errors.length) out += `\n\n> 契约警告：${errors.join('；')}`;
    return out;
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    finishTeam(teamId, 'failed');
    return `工具执行失败：${err?.message || String(err)}`;
  }
}

/* ==================== 注册 ==================== */

registerTool('spawn_agent_team', {
  source: 'builtin',
  enabled: true,
  schema: {
    type: 'function',
    function: {
      name: 'spawn_agent_team',
      description: '【组建智能体团队】组建一个通过「共享任务列表 + 成员邮箱」协作的 agent 团队：每个成员常驻执行自己的任务卡，运行中互相可见任务板状态、可互相留言配合，全部完结后向你提交团队摘要与各成员报告。适用场景：需要成员间配合/交接的复合任务（如调研→撰写→审校流水线、多角色评审）。与 spawn_subagent 的区别：subagent 是一次性派活收报告（无协作），team 是成员间持续协作。团队规模 2-6 人。',
      parameters: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: '团队共同目标（一句话）' },
          teammates: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: '成员名（团队内唯一，如 侦察兵-1 / 主笔 / 审校）' },
                agent: { type: 'string', enum: ['explorer', 'researcher', 'writer', 'critic'], description: '成员角色类型' },
                objective: { type: 'string', description: '该成员的任务目标（自包含）' },
                context: { type: 'string', description: '给该成员的背景材料' },
              },
              required: ['name', 'agent', 'objective'],
            },
            description: '成员列表（2-6 个），每个成员一张任务卡',
          },
        },
        required: ['goal', 'teammates'],
      },
    },
  },
  meta: {
    label: '组建团队',
    iconKey: 'bot',
    description: '组建共享任务列表 + 邮箱协作的 agent 团队',
    category: 'agents',
    timeoutMs: TEAM_TIMEOUT_MS,
  },
  executor: toolSpawnAgentTeam,
});

registerTool('update_team_task', {
  source: 'builtin',
  enabled: true,
  schema: {
    type: 'function',
    function: {
      name: 'update_team_task',
      description: '【团队协作】更新你名下的团队任务卡状态。状态机：pending → in_progress → done/failed；完成时必须附 result 结果摘要。只能更新自己的任务。',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: '任务卡 ID（见共享任务列表）' },
          status: { type: 'string', enum: ['in_progress', 'done', 'failed'], description: '目标状态' },
          result: { type: 'string', description: '结果摘要（done/failed 时必填）' },
        },
        required: ['task_id', 'status'],
      },
    },
  },
  meta: {
    label: '更新团队任务',
    iconKey: 'pencil',
    description: '更新团队共享任务板上自己的任务卡',
    category: 'agents',
    // 本地任务板写入：低风险免审批，但仅限队友上下文使用
    timeoutMs: 5_000,
  },
  executor: toolUpdateTeamTask,
});

registerTool('post_team_message', {
  source: 'builtin',
  enabled: true,
  schema: {
    type: 'function',
    function: {
      name: 'post_team_message',
      description: '【团队协作】给团队其他成员或 lead 发送消息（收件人在下一轮的系统注入中可见）。需要配合、交接材料、报告阻塞时使用。',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: "收件人：队友名 / 'lead' / '*'（广播）" },
          body: { type: 'string', description: '消息内容（精炼，1000 字以内）' },
        },
        required: ['to', 'body'],
      },
    },
  },
  meta: {
    label: '团队留言',
    iconKey: 'megaphone',
    description: '给团队成员或 lead 发送协作消息',
    category: 'agents',
    timeoutMs: 5_000,
  },
  executor: toolPostTeamMessage,
});
