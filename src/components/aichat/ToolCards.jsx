import React, { useState } from 'react';
import { ICONS } from '../../constants/appConstants.jsx';
import { showToast } from '../../utils/toast.js';

/**
 * v34：思考过程块（ReasoningBlock）
 * - 推理模型思维链（reasoning_content）实时流式展示，生成中默认展开实时可读；
 * - 完成后保留为可展开的"思考过程"步骤（按轮次分节），随时回看；
 * - 非推理模型无 reasoning 数据时返回 null（不占位）。
 */
export function ReasoningBlock({ reasoning = '', texts = [], loading = false }) {
  // hooks 规则：useState 必须在任何条件 return 之前
  const [expanded, setExpanded] = useState(false);
  const hasTexts = Array.isArray(texts) && texts.length > 0;
  const hasLive = typeof reasoning === 'string' && reasoning.trim().length > 0;
  if (!hasTexts && !hasLive) return null;
  const preview = String(hasLive ? reasoning : (texts[texts.length - 1]?.text || '')).slice(-180);
  return (
    <div className={`agent-reasoning${loading ? ' is-loading' : ''}${expanded ? ' is-expanded' : ''}`}>
      <button type="button" className="agent-reasoning-toggle" onClick={() => setExpanded(v => !v)}>
        <span className={`tool-call-chevron${expanded ? ' is-open' : ''}`}>▾</span>
        <span className="agent-reasoning-toggle-label">
          {loading ? '正在深度思考…（点击收起）' : '思考过程（点击展开回看）'}
        </span>
      </button>
      {!expanded && loading && (
        <pre className="agent-reasoning-preview custom-scrollbar">{preview}</pre>
      )}
      {expanded && (
        <div className="agent-reasoning-body custom-scrollbar">
          {hasTexts ? texts.map(t => (
            <div key={t.iter} className="agent-reasoning-round">
              <b className="agent-reasoning-round-label">第 {t.iter} 轮思考</b>
              <pre>{t.text}</pre>
            </div>
          )) : <pre>{reasoning}</pre>}
        </div>
      )}
    </div>
  );
}

/* 工具元信息：友好名称 + 简短图标，用于工具调用卡片展示 */
const TOOL_META = {
  read_workspace_file: { label: '读取文件', iconKey: 'document' },
  write_workspace_file: { label: '写入文件', iconKey: 'pencil' },
  search_news: { label: '检索资讯', iconKey: 'search' },
  web_search: { label: '联网搜索', iconKey: 'megaphone' },
  fetch_page: { label: '抓取网页', iconKey: 'globe' },
  get_stock_quote: { label: '股票行情', iconKey: 'trendingUp' },
  get_stock_kline: { label: 'K 线数据', iconKey: 'chart' },
  spawn_subagent: { label: '派出子代理', iconKey: 'bot' },
  spawn_agent_team: { label: '组建团队', iconKey: 'bot' },
  update_team_task: { label: '更新团队任务', iconKey: 'pencil' },
  post_team_message: { label: '团队留言', iconKey: 'megaphone' },
};

/* 子代理任务状态（progress patch 由 subagentRunner 经 emitProgress 推送） */
const SUB_STATUS_META = {
  running: { label: '执行中', cls: 'running' },
  done: { label: '已完成', cls: 'done' },
  failed: { label: '失败', cls: 'error' },
  aborted: { label: '已中止', cls: 'error' },
};

/* 子代理进度区：spawn_subagent 执行期间/结束后的每任务状态行 */
function SubagentProgress({ progress }) {
  if (!progress || progress.type !== 'subagent' || !Array.isArray(progress.tasks)) return null;
  return (
    <div className="tool-call-subagents">
      {progress.tasks.map((t, i) => {
        const st = SUB_STATUS_META[t.status] || SUB_STATUS_META.running;
        return (
          <div key={t.id || i} className={`tool-call-subagent tool-call-subagent-${st.cls}`}>
            <span className={`tool-call-subagent-dot tool-call-subagent-dot-${st.cls}`} />
            <span className="tool-call-subagent-name">{t.agentName || t.agent || `任务 ${i + 1}`}</span>
            <span className="tool-call-subagent-objective" title={t.objective}>{t.objective}</span>
            <span className="tool-call-subagent-status">
              {st.label}{t.tokens ? ` · ${Number(t.tokens).toLocaleString()} tokens` : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* 团队任务板：spawn_agent_team 执行期间/结束后的共享任务列表 + 成员状态 */
const TEAM_TASK_MARK = {
  pending: { label: '待认领', cls: 'pending' },
  in_progress: { label: '进行中', cls: 'running' },
  done: { label: '已完成', cls: 'done' },
  failed: { label: '失败', cls: 'error' },
};

function TeamProgress({ progress }) {
  if (!progress || progress.type !== 'team') return null;
  const tasks = Array.isArray(progress.tasks) ? progress.tasks : [];
  const members = Array.isArray(progress.members) ? progress.members : [];
  return (
    <div className="tool-call-team">
      {progress.goal && <div className="tool-call-team-goal">团队目标：{progress.goal}</div>}
      {tasks.length > 0 && (
        <div className="tool-call-team-board">
          {tasks.map((t) => {
            const st = TEAM_TASK_MARK[t.status] || TEAM_TASK_MARK.pending;
            return (
              <div key={t.id} className={`tool-call-team-task tool-call-team-task-${st.cls}`}>
                <span className={`tool-call-subagent-dot tool-call-subagent-dot-${st.cls === 'pending' ? 'idle' : st.cls}`} />
                <span className="tool-call-team-task-title" title={t.title}>{t.title}</span>
                <span className="tool-call-team-task-owner">@{t.owner}</span>
                <span className="tool-call-team-task-status">{st.label}</span>
              </div>
            );
          })}
        </div>
      )}
      {members.length > 0 && (
        <div className="tool-call-subagents">
          {members.map((m, i) => {
            const st = SUB_STATUS_META[m.status] || SUB_STATUS_META.running;
            return (
              <div key={m.id || i} className={`tool-call-subagent tool-call-subagent-${st.cls}`}>
                <span className={`tool-call-subagent-dot tool-call-subagent-dot-${st.cls}`} />
                <span className="tool-call-subagent-name">@{m.memberName || m.agentName}</span>
                <span className="tool-call-subagent-objective" title={m.objective}>{m.objective}</span>
                <span className="tool-call-subagent-status">
                  {st.label}{m.tokens ? ` · ${Number(m.tokens).toLocaleString()} tokens` : ''}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function summarizeArgs(name, args) {
  try {
    const a = args || {};
    if (name === 'read_workspace_file' || name === 'write_workspace_file') return a.path || '';
    if (name === 'search_news') return a.keyword || '';
    if (name === 'web_search') return a.query || a.keyword || '';
    if (name === 'fetch_page') return a.url || '';
    if (name === 'get_stock_quote' || name === 'get_stock_kline') return a.code || '';
    return JSON.stringify(a);
  } catch { return ''; }
}

/* 工具调用卡片：步骤序号 + 工具名 / 参数摘要 / 状态，点击整行展开完整参数与结果 */
export function ToolCallCard({ tc, step = 0, total = 0 }) {
  const [expanded, setExpanded] = useState(false);
  const meta = TOOL_META[tc.name] || { label: tc.name, iconKey: 'settings' };
  const summary = summarizeArgs(tc.name, tc.args);
  const isRunning = tc.status === 'running';
  // 检测工具结果是否为错误（约定：以"错误："或"工具执行失败"开头）
  const isError = !isRunning && typeof tc.result === 'string' &&
    /^(错误：|工具执行失败)/.test(tc.result.trim());
  const statusLabel = isRunning ? '执行中…' : (isError ? '出错' : '已完成');
  const statusClass = isError ? 'error' : tc.status;
  const resultText = typeof tc.result === 'string' ? tc.result : (tc.result ? JSON.stringify(tc.result, null, 2) : '');
  return (
    <div className={`tool-call tool-call-${statusClass}${expanded ? ' is-expanded' : ''}`}>
      <div className="tool-call-header" onClick={() => setExpanded(v => !v)} role="button" tabIndex={0}>
        {step > 0 && (
          <span className={`tool-call-step-badge${isRunning ? ' running' : ''}`} title={`第 ${step} / ${total || step} 步`}>
            {isRunning ? <span className="tool-call-step-spinner" /> : step}
          </span>
        )}
        <span className="tool-call-icon">{ICONS[meta.iconKey] || ICONS.settings}</span>
        <span className="tool-call-name">{meta.label}</span>
        {summary && <span className="tool-call-arg-summary" title={summary}>{summary}</span>}
        <span className={`tool-call-status tool-call-status-${statusClass}`}>
          {statusLabel}
        </span>
        <span className={`tool-call-chevron${expanded ? ' is-open' : ''}`}>▾</span>
      </div>
      {tc.progress?.type === 'subagent' && <SubagentProgress progress={tc.progress} />}
      {tc.progress?.type === 'team' && <TeamProgress progress={tc.progress} />}
      {expanded && (
        <div className="tool-call-body">
          <div className="tool-call-section">
            <div className="tool-call-section-label">输入参数</div>
            <pre className="tool-call-args">{JSON.stringify(tc.args || {}, null, 2)}</pre>
          </div>
          {resultText && (
            <div className="tool-call-section">
              <div className="tool-call-section-label">
                返回结果
                <button
                  type="button"
                  className="tool-call-copy"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard?.writeText(resultText);
                    showToast('结果已复制到剪贴板');
                  }}
                >复制</button>
              </div>
              <pre className={`tool-call-result${isError ? ' tool-call-result-error' : ''}`}>{resultText}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* 沙箱审批卡片：工具调用前展示，用户决策 Allow once / Allow always / Deny */
const APPROVAL_TOOL_META = {
  read_workspace_file: { label: '读取文件', iconKey: 'document' },
  write_workspace_file: { label: '写入文件', iconKey: 'pencil' },
  fetch_page: { label: '抓取网页', iconKey: 'globe' },
  web_search: { label: '联网搜索', iconKey: 'megaphone' },
  execute_command: { label: '执行命令', iconKey: 'terminal' },
};

export function ApprovalCard({ approval, onRespond }) {
  const { id, request } = approval;
  const meta = APPROVAL_TOOL_META[request.toolName] || { label: request.toolName, iconKey: 'settings' };
  const argsPreview = request.summary || JSON.stringify(request.args || {}).slice(0, 120);
  return (
    <div className="approval-card">
      <div className="approval-card-header">
        <span className="approval-card-icon">{ICONS[meta.iconKey] || ICONS.settings}</span>
        <span className="approval-card-title">沙箱审批请求</span>
        <span className="approval-card-tool">{meta.label}</span>
      </div>
      <div className="approval-card-body">
        <div className="approval-card-row">
          <span className="approval-card-label">工具：</span>
          <code className="approval-card-code">{request.toolName}</code>
        </div>
        {argsPreview && (
          <div className="approval-card-row">
            <span className="approval-card-label">参数：</span>
            <code className="approval-card-code">{argsPreview}</code>
          </div>
        )}
        {request.reason && (
          <div className="approval-card-row">
            <span className="approval-card-label">原因：</span>
            <span className="approval-card-text approval-card-reason">{request.reason}</span>
          </div>
        )}
        {request.agentName && (
          <div className="approval-card-row">
            <span className="approval-card-label">智能体：</span>
            <span className="approval-card-text">{request.agentName}</span>
          </div>
        )}
        <div className="approval-card-hint">
          工具调用前需要你确认。点「允许」本次会话内同工具免再问。
        </div>
      </div>
      <div className="approval-card-actions">
        <button type="button" className="approval-btn approval-btn-once" onClick={() => onRespond(id, 'allow-once')}>
          允许一次
        </button>
        <button type="button" className="approval-btn approval-btn-always" onClick={() => onRespond(id, 'allow-always')}>
          本会话免问
        </button>
        <button type="button" className="approval-btn approval-btn-deny" onClick={() => onRespond(id, 'deny')}>
          拒绝
        </button>
      </div>
    </div>
  );
}
