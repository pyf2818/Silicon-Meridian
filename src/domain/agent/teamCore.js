/**
 * teamCore.js - Agent Team 编排核（纯逻辑，无 React / 无 fetch，可单测）
 *
 * 与 subagent（派活收报告）不同，team 是**常驻协作**（对标 Claude Code agent teams）：
 * - 共享任务列表：lead 把目标拆成任务卡（含 owner），队友认领/推进/完结
 * - 邮箱消息：队友间与队友→lead 的点对点消息（<team_message> 结构化标签）
 * - 显式生命周期：每个任务必须被 owner 显式标记 done/failed（finalize 语义），
 *   lead 依据任务板状态汇总，不依赖猜测
 *
 * 状态存储在 src/store/teamStore.js（模块级单例 + localStorage 持久化）；
 * fetch 层执行器在 src/utils/agentTeamTools.js。
 */

export const TEAM_TASK_STATUS = ['pending', 'in_progress', 'done', 'failed'];

/** 队友数量上限（Claude Code max_team_size=32，本实现面向单机工作流，收紧到 6） */
export const TEAM_LIMITS = {
  MAX_TEAMMATES: 6,
  MIN_TEAMMATES: 2,
  MAX_MESSAGES: 100,        // 每团队消息上限（防黑板膨胀）
  TASK_RESULT_MAX_CHARS: 4000,
};

/**
 * 规范化团队组建请求。
 * @param {Object} raw { goal, teammates: [{name, agent, objective, context?}] }
 * @returns {{ plan: Object|null, errors: string[] }}
 *   plan: { goal, teammates: [{name, agent, preset, objective, context}], tasks: [...] }
 */
export function normalizeTeamPlan(raw, { getPreset }) {
  const errors = [];
  const teammates = Array.isArray(raw?.teammates) ? raw.teammates : [];
  const goal = String(raw?.goal || '').trim();
  if (!goal) errors.push('goal 不能为空（一句话说清团队要共同完成什么）');
  if (teammates.length < TEAM_LIMITS.MIN_TEAMMATES) {
    errors.push(`teammates 至少 ${TEAM_LIMITS.MIN_TEAMMATES} 个成员（团队需要协作而非单打）`);
  }
  if (teammates.length > TEAM_LIMITS.MAX_TEAMMATES) {
    errors.push(`teammates 超过上限 ${TEAM_LIMITS.MAX_TEAMMATES}`);
  }

  const normalized = [];
  const seenNames = new Set();
  teammates.forEach((m, idx) => {
    const name = String(m?.name || '').trim().slice(0, 30);
    const agent = String(m?.agent || '').trim();
    const objective = String(m?.objective || '').trim().slice(0, 2000);
    const preset = getPreset(agent);
    if (!name) { errors.push(`teammates[${idx}].name 不能为空`); return; }
    if (seenNames.has(name)) { errors.push(`teammates[${idx}].name "${name}" 重复`); return; }
    if (!preset) { errors.push(`teammates[${idx}].agent "${agent}" 不是有效子代理类型`); return; }
    if (!objective) { errors.push(`teammates[${idx}].objective 不能为空`); return; }
    seenNames.add(name);
    normalized.push({
      name,
      agent,
      preset,
      objective,
      context: String(m?.context || '').slice(0, 4000),
    });
  });

  if (errors.length) return { plan: null, errors };

  // 每个成员一张任务卡（owner 指定，认领制的前置形态）
  const teamId = `team_${Date.now().toString(36)}`;
  const tasks = normalized.map((m, idx) => ({
    id: `${teamId}_t${idx}`,
    title: m.objective.slice(0, 120),
    objective: m.objective,
    owner: m.name,
    status: 'pending',
    result: '',
    updatedAt: Date.now(),
  }));

  return { plan: { teamId, goal, teammates: normalized, tasks }, errors };
}

/**
 * 任务状态机：pending → in_progress → done | failed（不可跳级、不可回退）。
 * @returns {{ ok: boolean, error: string, task?: Object }}
 */
export function applyTaskStatusTransition(task, nextStatus, { by, result } = {}) {
  if (!task) return { ok: false, error: '任务不存在' };
  if (!TEAM_TASK_STATUS.includes(nextStatus)) {
    return { ok: false, error: `非法状态 "${nextStatus}"（可选：${TEAM_TASK_STATUS.join('/')}）` };
  }
  const from = task.status;
  const allowed = {
    pending: ['in_progress'],
    in_progress: ['done', 'failed'],
    done: [],
    failed: [],
  };
  if (!allowed[from].includes(nextStatus)) {
    return { ok: false, error: `任务 "${task.title}" 状态不能从 ${from} 变为 ${nextStatus}` };
  }
  return {
    ok: true,
    error: '',
    task: {
      ...task,
      status: nextStatus,
      result: String(result ?? task.result ?? '').slice(0, TEAM_LIMITS.TASK_RESULT_MAX_CHARS),
      updatedBy: by || task.owner,
      updatedAt: Date.now(),
    },
  };
}

/** 校验更新者是否有权操作该任务（owner 本人，或 lead） */
export function canUpdateTask(task, memberName, isLead = false) {
  if (isLead) return true;
  return Boolean(task && memberName && task.owner === memberName);
}

/** 共享任务列表的看板文本（注入每个队友每轮的 system prompt 后缀） */
export function buildSharedTaskListText(team) {
  if (!team) return '';
  const rows = (team.tasks || []).map(t => {
    const mark = { pending: '[待认领]', in_progress: '[进行中]', done: '[已完成]', failed: '[失败]' }[t.status] || '[?]';
    const owner = `@${t.owner}`;
    const result = t.result ? ` 结果：${String(t.result).slice(0, 120)}` : '';
    return `- ${mark} ${t.id} ${owner} ${t.title}${result}`;
  }).join('\n');
  return [
    `【共享任务列表】（团队 "${team.goal}"，实时快照——每个队友都能看到全部任务状态）`,
    rows,
    '协作规则：只更新自己的任务；完成时必须用 update_team_task 标记 done 并附结果摘要；',
    '需要其他成员配合或给 lead 留言时用 post_team_message；不要重复他人已完成的工作。',
  ].join('\n');
}

/**
 * 构造结构化团队消息（写入黑板与收件人可见）。
 */
export function buildTeamMessage({ teamId, from, to, body }) {
  const text = String(body || '').trim().slice(0, 1000);
  return {
    id: `msg_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e4)}`,
    teamId,
    from: String(from || '').slice(0, 30),
    to: String(to || 'lead').slice(0, 30), // 'lead' 或队友名；'*' 为广播
    body: text,
    at: Date.now(),
  };
}

/** 队友可见的消息段（每轮注入：发给自己的 + 广播；不含草稿） */
export function buildMailboxText(team, memberName) {
  const msgs = (team?.messages || []).filter(m => m.to === memberName || m.to === '*' || (memberName === 'lead' && m.to === 'lead'));
  if (!msgs.length) return '';
  return [
    `【团队邮箱】收到的消息（最新 ${msgs.length} 条，来自其他成员）：`,
    ...msgs.slice(-10).map(m => `- <team_message from="${m.from}" to="${m.to}">${m.body}</team_message>`),
  ].join('\n');
}

/* ============ 智能调度器（v26.8 #19） ============
 * 问题：此前每条消息都全员广播认领——寒暄也让 6 个成员各跑一次 LLM，
 * 观感就是"所有员工都被触发"；且成员认领过度热情，简单提问撰写者也写文章。
 * 方案：发布消息后先跑一次轻量调度（router），判定谁直接回应 / 谁参与认领 / 谁无关。
 * 纯逻辑（prompt 构造 + 宽松解析）在此文件，LLM 调用在 AgentTeamChat。 */

/** 调度判定 { simple:boolean, respond:string[], consider:string[], unknown:string[] } */
export function parseRouterVerdict(text, memberPresets) {
  const raw = String(text || '');
  const simple = /【\s*简单(对话|提问|交流)?\s*】/.test(raw);
  const lines = raw.split(/\n+/);
  const readList = (labelRe) => {
    const line = lines.find(l => labelRe.test(l));
    if (!line) return [];
    return line.replace(labelRe, '').split(/[、,，;；\s/]+/).map(s => s.trim()).filter(Boolean);
  };
  const respondNames = readList(/直接回应[:：]?/);
  const considerNames = readList(/参与认领[:：]?/);
  const byName = (names) => {
    const ids = [];
    names.forEach(name => {
      const clean = name.replace(/^@/, '').trim();
      if (!clean) return;
      const preset = memberPresets.find(p => p.name === clean
        || p.id.toLowerCase() === clean.toLowerCase()
        || p.name.toLowerCase() === clean.toLowerCase());
      if (preset && !ids.includes(preset.id)) ids.push(preset.id);
    });
    return ids;
  };
  const respond = byName(respondNames);
  const consider = byName(considerNames).filter(id => !respond.includes(id));
  // 解析完整性：两个名单都没解析出任何成员 → 视为无效（调用方降级全员认领）
  const valid = respond.length > 0 || consider.length > 0;
  return { simple, respond, consider, valid };
}

/** 调度器 prompt：给成员名册 + 本轮消息，要求输出可直接 parseRouterVerdict 的格式 */
export function buildRouterPrompt({ userText, transcript = '', memberPresets = [] }) {
  const roster = memberPresets
    .map(p => `- ${p.name}：${String(p.description || '').slice(0, 60)}`)
    .join('\n');
  return [
    '你是团队任务调度器。根据这条消息判断每位成员是否需要参与本轮回复。',
    '判断原则：',
    '- 简单提问/寒暄/只需要回答的问题：标注为【简单对话】，只让职责最相关的 1-2 人「直接回应」，其余无人参与；',
    '- 需要多人协作的任务/分析/创作：标注为【任务】，列出「直接回应」的核心成员与「参与认领」的可补充成员；',
    '- 与成员职责无关就不要写进任何名单（不参与、不产出、不打扰）。',
    '',
    `【成员名册】\n${roster}`,
    transcript ? `【近期群聊上下文（截断）】\n${transcript}` : '',
    `【本轮消息】\n${userText}`,
    '',
    '只按以下格式输出（不要多余内容）：',
    '第一行：【简单对话】或【任务】',
    '第二行：直接回应：成员名、成员名',
    '第三行：参与认领：成员名、成员名（无则写「无」）',
  ].filter(Boolean).join('\n');
}

/** lead 用的团队执行摘要（全部报告 + 消息流） */
export function formatTeamDigest(team, memberReports) {
  const tasks = team?.tasks || [];
  const done = tasks.filter(t => t.status === 'done').length;
  const failed = tasks.filter(t => t.status === 'failed').length;
  const lines = [
    `## 团队执行汇总（${team?.goal || ''}）`,
    `- 成员：${(team?.teammates || []).length}；任务：${tasks.length}（完成 ${done} / 失败 ${failed} / 其余未完结）`,
    `- 消息流：${(team?.messages || []).length} 条`,
    '',
    '### 任务板',
    ...(tasks.map(t => `- ${t.status === 'done' ? 'x' : t.status === 'failed' ? '!' : ' '} [${t.status}] @${t.owner} ${t.title}${t.result ? ` → ${String(t.result).slice(0, 300)}` : ''}`)),
    '',
    '### 成员最终报告',
  ];
  for (const r of memberReports || []) {
    if (r.status === 'done' && r.report) {
      lines.push(`#### @${r.memberName}（${r.agentName}）`);
      lines.push(String(r.report).slice(0, 6000));
      lines.push('');
    } else {
      lines.push(`#### @${r.memberName}（${r.agentName}）— 未完成：${r.error || r.status}`);
      lines.push('');
    }
  }
  return lines.join('\n');
}
