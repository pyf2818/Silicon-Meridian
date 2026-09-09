/**
 * EvolutionProfile - Agent 进化档案面板（v26 #13）
 *
 * 只读展示 + 噪声清理：
 * - 等级徽章 + 成长值进度环/条（距下一级还差多少）
 * - 进化树：里程碑纵向时间树（升级事件自动记录）
 * - 工作经验列表：时间倒序，可单条删除（沉淀错了的结论由用户裁决）
 * - 统计网格：任务数 / 工具调用 / 经验条数 / 技能
 */
import { useEffect, useMemo, useState } from 'react';
import {
  getEvolution, subscribeEvolution, removeExperience, EVOLUTION_LEVELS,
} from '../../domain/agent/agentEvolution.js';
import { ICONS } from '../../constants/appConstants.jsx';
import { showToast } from '../../utils/toast.js';

const fmtDate = (ts) => new Date(ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });

export default function EvolutionProfile({ agentId, agentName }) {
  const [version, setVersion] = useState(0);
  useEffect(() => subscribeEvolution(() => setVersion(v => v + 1)), []);

  const evo = useMemo(() => getEvolution(agentId), [agentId, version]);
  if (!agentId) return null;

  const { level, stats, milestones, experiences } = evo;
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
