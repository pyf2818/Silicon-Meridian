/**
 * AgentTeamPanel - AI 工作站「执行记录」页
 *
 * 本页只回答一个问题："我派出去的 AI 团队，活干得怎么样了？"
 * （v10 精简：删除模式/角色大段说明文案——概念讲解由侧栏「编排能力」与
 * 群聊空态引导承担；发起入口压缩成一行按钮，职责说明收进 tooltip；
 * 最近团队列表升为页面主体。v11：组建团队/派活统一改道团队群聊——
 * 任务在群里 @ 成员发布（认领 → 接力），不再切到单人对话。）
 *
 * - 顶栏：标题 + 执行中徽标 + 「派单代理任务 / ＋组建团队」（→ 群聊 @ 预填）
 * - 快速派活：4 个子代理 preset 一行 chips（点击 → 群聊 @ 该成员）
 * - 团队区：最近团队（新→旧，来自 teamStore），展开为成员卡 +
 *   四态任务看板 + 邮箱消息流 —— 与 teamCore 协议一一对应
 */
import { useEffect, useMemo, useState } from 'react';
import { SUBAGENT_PRESETS } from '../../domain/agent/subagentCore.js';
import { listTeams, subscribeTeams } from '../../store/teamStore.js';
import { listSessionsWithPlan, subscribe as subscribeSessionStore } from '../../utils/sessionStore.js';
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

/* 发起入口都走团队群聊（任务在群里 @ 成员发布，认领接力）：
   onLaunch(text) → 父层切到群聊视图并把 text 预填进群聊输入框 */
const TEAM_START_TEXT = '@探索者 @研究员 @撰写者 ';
const SUBAGENT_START_TEXT = '@研究员 ';

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
 * 执行记录主面板。
 * @param {Function} onLaunch  点击「发起」→ 父层切到团队群聊视图并把 @ 指派预填进群聊输入框
 */
/** 单人执行记录的数据源：sessionStore 里产生过执行计划的会话（订阅实时刷新） */
function useSessionPlans() {
  const [plans, setPlans] = useState(() => listSessionsWithPlan());
  useEffect(() => subscribeSessionStore(() => setPlans(listSessionsWithPlan())), []);
  return plans;
}

const SESSION_TASK_STATUS = {
  done: { label: '完成', cls: 'is-done' },
  in_progress: { label: '执行中', cls: 'is-running' },
  failed: { label: '失败', cls: 'is-failed' },
  pending: { label: '待执行', cls: 'is-pending' },
};

/** 单人（会话级）执行记录卡：与团队卡同款交互，展示该会话的执行计划任务列表 */
function SessionPlanCard({ entry }) {
  const [open, setOpen] = useState(false);
  const first = entry.plan[0] || {};
  const status = SESSION_TASK_STATUS[first.status] || SESSION_TASK_STATUS.pending;
  const doneCount = entry.plan.filter(t => t.status === 'done').length;
  const title = first.title || `会话 ${String(entry.sessionId).slice(0, 8)}`;
  return (
    <div className={`team-card ${open ? 'is-open' : ''}`}>
      <button type="button" className="team-card-head" onClick={() => setOpen(o => !o)}>
        <span className={`team-status-badge ${status.cls}`}>{status.label}</span>
        <span className="team-card-goal">{title}</span>
        <span className="team-card-meta">
          单人 · {doneCount}/{entry.plan.length} 任务 · {formatTime(entry.updatedAt)}
        </span>
      </button>
      {open && (
        <div className="team-card-body">
          {entry.plan.map(t => {
            const meta = SESSION_TASK_STATUS[t.status] || SESSION_TASK_STATUS.pending;
            return (
              <div key={t.id} className="team-task-row" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className={`team-status-badge ${meta.cls}`} style={{ flexShrink: 0 }}>{meta.label}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.title || t.id}{t.result ? ` · ${String(t.result).slice(0, 60)}` : ''}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function AgentTeamPanel({ onLaunch, activeSessionTitle = '' }) {
  const teams = useTeams();
  const sessionPlans = useSessionPlans();
  const runningCount = teams.filter(t => t.status === 'running').length;

  return (
    <div className="team-center">
      {/* 顶栏：一句话标题 + 发起入口（概念说明收进 tooltip） */}
      <header className="team-center-head">
        <div className="team-center-title">
          <h2>执行记录</h2>
          {runningCount > 0 && <span className="team-center-running">● {runningCount} 个团队执行中</span>}
        </div>
        <div className="team-center-actions">
          <button
            type="button"
            className="team-launch-btn"
            title="去团队群聊，@ 单个成员派活（成员认领后独立执行并回群）"
            onClick={() => onLaunch?.(SUBAGENT_START_TEXT)}
          >派单代理任务</button>
          <button
            type="button"
            className="team-launch-btn is-primary"
            title="去团队群聊，@ 多个成员发布任务（认领 → 接力产出）"
            onClick={() => onLaunch?.(TEAM_START_TEXT)}
          >＋ 组建团队</button>
        </div>
      </header>

      {/* 快速派活：一行 chips，点击去群聊 @ 该成员；职责/预算在 tooltip */}
      <div className="team-quick-row">
        <span className="team-quick-label">快速派活</span>
        {SUBAGENT_PRESETS.map(p => (
          <button
            key={p.id}
            type="button"
            className="team-quick-chip"
            title={`${p.description}\n（${(p.tools || []).length} 个工具 · ≤ ${p.maxTurns} 轮）`}
            onClick={() => onLaunch(`@${p.name} `)}
          >{p.name}</button>
        ))}
      </div>

      {/* 单人任务记录：会话级执行计划（set_plan / add_task 产生的任务）——
          让「群聊发目标 / 对话设任务」即使没组建团队也有记录可查 */}
      {sessionPlans.length > 0 && (
        <section className="team-list-section">
          <div className="team-list-head">
            <h3>单人任务记录</h3>
            <span>{sessionPlans.length} 个会话</span>
          </div>
          {sessionPlans.map(entry => (
            <SessionPlanCard key={entry.sessionId} entry={entry} />
          ))}
        </section>
      )}

      {/* 最近团队：页面主体 */}
      <section className="team-list-section">
        <div className="team-list-head">
          <h3>最近团队</h3>
          <span>{teams.length} 个</span>
        </div>
        {teams.length === 0 ? (
          <div className="team-empty">
            <p>还没有团队记录</p>
            <button type="button" className="team-launch-btn is-primary" onClick={() => onLaunch?.(TEAM_START_TEXT)}>
              组建第一个团队
            </button>
            <small>在群聊里 @ 成员发布任务</small>
          </div>
        ) : (
          teams.map((t, i) => <TeamCard key={t.id} team={t} defaultOpen={i === 0} />)
        )}
      </section>
    </div>
  );
}
