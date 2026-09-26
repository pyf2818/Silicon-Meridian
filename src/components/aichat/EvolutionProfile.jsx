/**
 * EvolutionProfile - Agent 进化档案面板（v26 #13，v39 图形化升级）
 *
 * 只读展示 + 噪声清理：
 * - 等级徽章 + 成长值进度环/条（距下一级还差多少）
 * - v39 成长趋势图：SVG 渐变面积折线（成长值时间序列）+ 等级阈值参考线 + 区间增量
 * - 进化树：里程碑纵向时间树（升级事件自动记录）
 * - 工作经验列表：时间倒序，可单条删除（沉淀错了的结论由用户裁决）
 * - 统计网格：任务数 / 工具调用 / 经验条数 / 技能（v39 附区间增量）
 */
import { useEffect, useMemo, useState } from 'react';
import {
  getEvolution, subscribeEvolution, removeExperience, EVOLUTION_LEVELS,
} from '../../domain/agent/agentEvolution.js';
import { ICONS } from '../../constants/appConstants.jsx';
import { showToast } from '../../utils/toast.js';

const fmtDate = (ts) => new Date(ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
const fmtTime = (ts) => new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

/** v39 成长趋势 SVG：渐变面积折线 + 等级阈值虚线 + 末点标记。
 *  数据不足 2 点时给占位说明（首次工作后即有曲线）。 */
function EvolutionTrend({ history = [] }) {
  const W = 300;
  const H = 92;
  const PAD_X = 6;
  const PAD_Y = 12;

  if (!Array.isArray(history) || history.length < 2) {
    return (
      <div className="evo-trend evo-trend-empty">
        <span>成长曲线将在完成几次任务后出现（当前样本不足）。</span>
      </div>
    );
  }

  const scores = history.map(p => p.score);
  const maxScore = Math.max(scores[scores.length - 1], EVOLUTION_LEVELS[2]?.minScore || 40);
  const minScore = 0;
  const span = Math.max(1, maxScore - minScore);
  const xAt = (i) => PAD_X + (i / Math.max(1, history.length - 1)) * (W - PAD_X * 2);
  const yAt = (score) => H - PAD_Y - ((score - minScore) / span) * (H - PAD_Y * 2);

  const points = history.map((p, i) => `${xAt(i).toFixed(1)},${yAt(p.score).toFixed(1)}`);
  const linePath = `M${points.join(' L')}`;
  const areaPath = `${linePath} L${xAt(history.length - 1).toFixed(1)},${H - PAD_Y} L${xAt(0).toFixed(1)},${H - PAD_Y} Z`;

  // 等级阈值参考线（跳过 Lv0；只画落在当前量程内的）
  const levelLines = EVOLUTION_LEVELS
    .filter(lv => lv.level > 0 && lv.minScore <= maxScore)
    .map(lv => ({ level: lv.level, name: lv.name, y: yAt(lv.minScore) }));

  const delta = scores[scores.length - 1] - scores[0];
  const lastPoint = history[history.length - 1];

  return (
    <div className="evo-trend">
      <div className="evo-trend-head">
        <span className="evo-trend-title">成长趋势</span>
        <span className={`evo-trend-delta ${delta > 0 ? 'is-up' : 'is-flat'}`}>
          {delta > 0 ? `▲ +${delta}` : '— 0'}（近 {history.length} 次工作）
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="evo-trend-svg" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="evo-trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent-cyan, #22d3ee)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--accent-cyan, #22d3ee)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {levelLines.map(lv => (
          <g key={lv.level}>
            <line x1={PAD_X} x2={W - PAD_X} y1={lv.y} y2={lv.y} stroke="currentColor" strokeDasharray="3 4" opacity="0.22" />
            <text x={W - PAD_X} y={lv.y - 3} textAnchor="end" className="evo-trend-lvlabel">
              Lv{lv.level}
            </text>
          </g>
        ))}
        <path d={areaPath} fill="url(#evo-trend-fill)" />
        <path d={linePath} fill="none" stroke="var(--accent-cyan, #22d3ee)" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={xAt(history.length - 1)} cy={yAt(lastPoint.score)} r="3" fill="var(--accent-cyan, #22d3ee)" />
      </svg>
      <div className="evo-trend-foot">
        <span>{fmtTime(history[0].at)}</span>
        <span>最新 {lastPoint.score} · {fmtTime(lastPoint.at)}</span>
      </div>
    </div>
  );
}

export default function EvolutionProfile({ agentId, agentName }) {
  const [version, setVersion] = useState(0);
  useEffect(() => subscribeEvolution(() => setVersion(v => v + 1)), []);

  const evo = useMemo(() => getEvolution(agentId), [agentId, version]);
  if (!agentId) return null;

  const { level, stats, milestones, experiences, history } = evo;
  const pct = level.next
    ? Math.min(100, Math.round(((level.score - level.minScore) / (level.next.minScore - level.minScore)) * 100))
    : 100;

  const handleRemove = (ex) => {
    if (removeExperience(agentId, ex.id)) showToast('已删除该条经验');
  };

  return (
    <div className="evo-profile">
      {/* 等级 + 成长值 */}
      <div className="evo-level-row">
        <span className={`evo-level-badge is-lv${level.level}`}>Lv{level.level} · {level.name}</span>
        <span className="evo-level-score">成长值 {level.score}{level.next ? ` / ${level.next.minScore}` : '（已满级）'}</span>
      </div>
      <div className="evo-progress">
        <div className="evo-progress-bar" style={{ width: `${pct}%` }} />
      </div>
      <div className="evo-level-hint">
        {level.next ? `距「${level.next.name}」还需 ${level.next.minScore - level.score} 成长值 —— ${level.hint}` : level.hint}
      </div>

      {/* v39 成长趋势图 */}
      <EvolutionTrend history={history} />

      {/* 统计网格 */}
      <div className="evo-stats">
        <div className="evo-stat"><b>{stats.runs || 0}</b><span>任务</span></div>
        <div className="evo-stat"><b>{stats.toolCalls || 0}</b><span>工具调用</span></div>
        <div className="evo-stat"><b>{stats.skills || 0}</b><span>技能</span></div>
        <div className="evo-stat"><b>{experiences.length}</b><span>经验</span></div>
      </div>

      {/* 进化树：里程碑纵向时间线 */}
      {milestones.length > 0 && (
        <div className="evo-tree">
          <div className="evo-tree-title">进化树</div>
          <ul className="evo-tree-list">
            {milestones.map(ms => (
              <li key={ms.id} className={`evo-tree-node is-lv${ms.level}`}>
                <span className="evo-tree-dot" />
                <span className="evo-tree-label">{ms.label}</span>
                <time>{fmtDate(ms.at)}</time>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 工作经验沉淀 */}
      <div className="evo-exp">
        <div className="evo-tree-title">工作经验（自动沉淀，注入每次对话）</div>
        {experiences.length === 0 && (
          <div className="evo-exp-empty">还没有经验沉淀——完成几次真实任务后会自动出现。</div>
        )}
        <ul className="evo-exp-list">
          {experiences.slice(0, 12).map(ex => (
            <li key={ex.id} className="evo-exp-item">
              <div className="evo-exp-head">
                <b>{ex.topic || '未命名任务'}</b>
                <span className="evo-exp-meta">{fmtDate(ex.at)} · {ex.source}</span>
                <button
                  type="button"
                  className="evo-exp-del"
                  onClick={() => handleRemove(ex)}
                  title="删除这条经验（沉淀有误时手动清理）"
                >{ICONS.x || '×'}</button>
              </div>
              <p className="evo-exp-text">{ex.lesson}</p>
            </li>
          ))}
        </ul>
      </div>

      {/* 等级阶梯说明 */}
      <div className="evo-ladder">
        {EVOLUTION_LEVELS.map(lv => (
          <span key={lv.level} className={`evo-ladder-step ${lv.level <= level.level ? 'reached' : ''}`}>
            Lv{lv.level} {lv.name}
          </span>
        ))}
      </div>
    </div>
  );
}
