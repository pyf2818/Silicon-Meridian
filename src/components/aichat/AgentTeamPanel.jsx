/**
 * AgentTeamPanel - AI 工作站「团队中心」专有页面
 *
 * spawn_subagent / spawn_agent_team 能力此前只存在于工具注册表里，
 * 用户在 UI 上看不见它们。本页面把多智能体能力首次前端化：
 *
 * - 能力区：4 个子代理 preset（explorer/researcher/writer/critic）+
 *   单代理 / 团队两种编排模式的说明与「发起」按钮（一键填 prompt）
 * - 团队区：最近团队（新→旧，来自 teamStore，localStorage 持久化），
 *   每个团队展开为：成员卡 + 四态任务看板（待认领/进行中/已完成/失败）
 *   + 邮箱消息流 —— 与 teamCore 的共享任务列表/邮箱协议一一对应
 */
import { useEffect, useMemo, useState } from 'react';
import { SUBAGENT_PRESETS } from '../../domain/agent/subagentCore.js';
import { listTeams, subscribeTeams } from '../../store/teamStore.js';
import { ICONS } from '../../constants/appConstants.jsx';

const TEAM_STATUS_META = {
  running: { label: '执行中', cls: 'is-running' },
  completed: { label: '已完成', cls: 'is-done' },
  failed: { label: '失败', cls: 'is-failed' },
};

const TASK_COL_DEFS = [
  { status: 'pending', label: '待认领' },
  { status: 'in_progress', label: '进行中' },
  { status: 'done', label: '已完成' },
  { status: 'failed', label: '失败' },
];

const LAUNCH_TEAM_PROMPT = '请用 spawn_agent_team 组建一个团队完成以下目标：「（在这里写目标）」。要求：3 个成员，分别负责调研、分析与写作，任务完成后由 lead 汇总出最终结论。';
const LAUNCH_SUBAGENT_PROMPT = '请用 spawn_subagent 派一个 researcher 子代理调研：「（在这里写调研问题）」，要求返回带来源的调研报告。';

function useTeams() {
  // 注意：不能用 useSyncExternalStore + listTeams()——getSnapshot 每次返回新数组
  // 会触发 "Maximum update depth exceeded" 无限循环；改用显式订阅 + setState。
  const [teams, setTeams] = useState(() => listTeams());
  useEffect(() => subscribeTeams(() => setTeams(listTeams())), []);
  return teams;
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/* ---------- 能力卡：单个子代理 preset ---------- */
function PresetCard({ preset, onLaunch }) {
  return (
    <div className="team-preset-card" title={preset.description}>
      <div className="team-preset-head">
        <span className="team-preset-name">{preset.name}</span>
        <span className="team-preset-id">{preset.id}</span>
      </div>
      <p className="team-preset-desc">{preset.description}</p>
      <div className="team-preset-meta">
        <span title={`工具白名单：${(preset.tools || []).join('、')}`}>{(preset.tools || []).length} 个工具</span>
        <i />
        <span>≤ {preset.maxTurns} 轮</span>
      </div>
      <button
        type="button"
        className="team-preset-launch"
        onClick={() => onLaunch(`请用 spawn_subagent 派一个 ${preset.id} 子代理完成任务：「（在这里写目标）」。`)}
      >派活 →</button>
    </div>
  );
}

/* ---------- 单个团队卡：成员 + 看板 + 邮箱 ---------- */
function TeamCard({ team, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const [showMail, setShowMail] = useState(false);
  const status = TEAM_STATUS_META[team.status] || TEAM_STATUS_META.completed;
  const taskCols = useMemo(() => TASK_COL_DEFS.map(col => ({
    ...col,
    tasks: (team.tasks || []).filter(t => t.status === col.status),
  })), [team]);

  return (
    <div className={`team-card ${open ? 'is-open' : ''}`}>
      <button type="button" className="team-card-head" onClick={() => setOpen(o => !o)}>
        <span className={`team-card-arrow ${open ? 'open' : ''}`} aria-hidden="true">▸</span>
        <span className={`team-status-badge ${status.cls}`}>{status.label}</span>
        <span className="team-card-goal">{team.goal || '（未命名目标）'}</span>
        <span className="team-card-meta">
          {(team.teammates || []).length} 成员 · {(team.tasks || []).length} 任务 · {formatTime(team.updatedAt)}
        </span>
      </button>

      {open && (
        <div className="team-card-body">
          {/* 成员行 */}
          <div className="team-members">
            {(team.teammates || []).map(m => (
              <span key={m.name} className="team-member-chip" title={m.objective}>
                <b>@{m.name}</b>
                <i>{m.preset?.id || m.agent}</i>
              </span>
            ))}
          </div>

          {/* 四态任务看板 */}
          <div className="team-kanban">
            {taskCols.map(col => (
              <div key={col.status} className={`team-kanban-col is-${col.status}`}>
                <div className="team-kanban-col-head">
                  <span>{col.label}</span>
                  <b>{col.tasks.length}</b>
                </div>
                {col.tasks.length === 0 && <div className="team-kanban-empty">—</div>}
                {col.tasks.map(t => (
                  <div key={t.id} className="team-task-card" title={t.result ? `结果：${t.result}` : t.objective}>
                    <span className="team-task-title">{t.title}</span>
                    <span className="team-task-owner">@{t.owner}</span>
                    {t.result && <p className="team-task-result">{String(t.result).slice(0, 80)}</p>}
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* 邮箱消息流 */}
          {(team.messages || []).length > 0 && (
            <div className="team-mailbox">
              <button type="button" className="team-mailbox-toggle" onClick={() => setShowMail(s => !s)}>
                {ICONS.mail || '✉'} 团队邮箱（{team.messages.length} 条）{showMail ? '收起' : '展开'}
              </button>
              {showMail && (
                <ul className="team-mailbox-list custom-scrollbar">
                  {team.messages.slice(-30).reverse().map(m => (
                    <li key={m.id} className="team-mailbox-msg">
                      <span className="team-mailbox-route">@{m.from} → @{m.to}</span>
                      <p>{m.body}</p>
                      <time>{formatTime(m.at)}</time>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 团队中心主面板。
 * @param {Function} onLaunch  点击「发起」→ 父层切回对话视图并把 prompt 填入输入框
 */
export default function AgentTeamPanel({ onLaunch, activeSessionTitle = '' }) {
  const teams = useTeams();
  const runningCount = teams.filter(t => t.status === 'running').length;

  return (
    <div className="team-center">
      <header className="team-center-head">
        <div>
          <span className="team-center-kicker">AGENT TEAMS</span>
          <h2>团队中心</h2>
          <p>
            编排者-工作者模式：<b>spawn_subagent</b> 派活收报告，<b>spawn_agent_team</b> 组建常驻团队
            （共享任务板 + 成员邮箱）。{runningCount > 0 && <em> ● {runningCount} 个团队执行中</em>}
          </p>
        </div>
      </header>

      {/* ============ 能力区：编排模式 + 子代理 preset ============ */}
      <section className="team-capabilities">
        <div className="team-mode-row">
          <div className="team-mode-card">
            <span className="team-mode-name">单代理派活</span>
            <code>spawn_subagent</code>
            <p>独立上下文运行，收一份结构化报告回主循环；工具白名单收窄、深度封顶 1 层，不会递归失控。</p>
            <button type="button" className="team-launch-btn" onClick={() => onLaunch?.(LAUNCH_SUBAGENT_PROMPT)}>
              发起单代理任务
            </button>
          </div>
          <div className="team-mode-card is-team">
            <span className="team-mode-name">常驻团队</span>
            <code>spawn_agent_team</code>
            <p>lead 拆解目标为任务卡，队友认领推进并显式标记 done/failed；成员间通过团队邮箱点对点协作，最后由 lead 汇总。</p>
            <button type="button" className="team-launch-btn is-primary" onClick={() => onLaunch?.(LAUNCH_TEAM_PROMPT)}>
              组建一个团队
            </button>
          </div>
        </div>

        <div className="team-preset-grid">
          {SUBAGENT_PRESETS.map(p => (
            <PresetCard key={p.id} preset={p} onLaunch={onLaunch} />
          ))}
        </div>
      </section>

      {/* ============ 团队列表 ============ */}
      <section className="team-list-section">
        <div className="team-list-head">
          <h3>最近团队</h3>
          <span>{teams.length} 个（保留最近 10 个）</span>
        </div>
        {teams.length === 0 ? (
          <div className="team-empty">
            <p>还没有团队记录。在上面的「组建一个团队」或对话里说「用团队完成 XX」，任务板和邮箱就会出现在这里。</p>
          </div>
        ) : (
          teams.map((t, i) => <TeamCard key={t.id} team={t} defaultOpen={i === 0} />)
        )}
      </section>
    </div>
  );
}
