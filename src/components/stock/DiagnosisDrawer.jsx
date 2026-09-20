/**
 * DiagnosisDrawer — 股市 AI 诊断右侧抽屉（v29）
 * 从 StockPage 底部分析 section 迁移而来，解决三个问题：
 *  1) 位置：底部 section 要滚动才能看 → 右侧滑出抽屉，随开随看，不挤占行情终端；
 *  2) 状态：诊断本体在模块级 store，切页可恢复；配合 selectedCode 持久化，切回页面不丢；
 *  3) 记录：新增「历史记录」tab——每次诊断落 localStorage（最近 30 条），可回看/存素材/删除。
 * 样式语言对齐 monitor-drawer（overlay + slideInRight + stats grid）。
 */
import { useState } from 'react';
import { ICONS } from '../../constants/index.jsx';
import { renderMarkdown } from '../../utils/markdown.jsx';
import ProCharts from './ProCharts.jsx';
import { showToast } from '../../utils/toast.js';

const RISK_LABEL = { high: '高', medium: '中', low: '低', unknown: '--' };

export default function DiagnosisDrawer({
  open,
  onClose,
  ai,
  selectedName,
  selectedCode,
  experienceMode,
  diagKlines,
  klineData,
  runDiagnosis,
  archiveDiagnosis,
  onArchiveMaterial,
  onOpenLlmConfig,
  canRun,
  streamText = '',
}) {
  const [tab, setTab] = useState('report'); // 'report' | 'history'
  const [viewing, setViewing] = useState(null); // 历史记录只读视图
  const [expandedThesis, setExpandedThesis] = useState({});
  const toggleThesis = key => setExpandedThesis(prev => ({ ...prev, [key]: !prev[key] }));
  const diagnosis = ai?.diagnosis;

  if (!open) return null;

  // 历史记录 → 素材库（复用 archiveDiagnosis 的格式约定）
  const archiveRecord = record => {
    if (!onArchiveMaterial) return;
    onArchiveMaterial({
      title: `股市AI分析：${record.name || selectedName}（${record.code || selectedCode}）`,
      content: record.content,
      fullContent: [
        `# 股市AI分析：${record.name || selectedName}（${record.code || selectedCode}）`,
        `分析模式：${record.mode === 'ai' ? 'AI 增强' : '确定性算法'} ｜ 归档自诊断历史`,
        `评级：${record.rating} ｜ 风险：${RISK_LABEL[record.risk] || record.risk || '--'} ｜ 现价：${record.price ?? '--'}`,
        `诊断时间：${new Date(record.at).toLocaleString('zh-CN')}`,
        '',
        record.content,
      ].join('\n'),
      type: 'viewpoint',
      source: '股市 AI 分析',
      tags: ['股市', 'AI分析', '历史归档'],
      metadata: { kind: 'stock-analysis', code: record.code, mode: record.mode, at: record.at },
    });
    showToast(`已存入素材库：股市AI分析 · ${record.name || selectedName}`);
  };

  return (
    <div className="stock-diag-overlay" onClick={onClose}>
      <aside className="stock-diag-drawer" onClick={e => e.stopPropagation()} role="dialog" aria-label="AI 诊断">
        <header className="stock-diag-head">
          <div className="stock-diag-title">
            <h3>{ICONS.sparkle} AI 诊断 · {diagnosis?.stock?.name || selectedName}</h3>
            <span className="stock-diag-sub">{diagnosis?.stock?.code || selectedCode} · {experienceMode === 'pro' ? '专业版' : '新手版'}</span>
          </div>
          <button className="stock-diag-close" onClick={onClose} aria-label="关闭">×</button>
        </header>

        <nav className="stock-diag-tabs" role="tablist">
          <button type="button" className={tab === 'report' && !viewing ? 'active' : ''} onClick={() => { setTab('report'); setViewing(null); }} role="tab">诊断报告</button>
          <button type="button" className={tab === 'history' || viewing ? 'active' : ''} onClick={() => { setTab('history'); setViewing(null); }} role="tab">历史记录（{ai.diagnosisHistory.length}）</button>
        </nav>

        <div className="stock-diag-body custom-scrollbar">
          {viewing ? (
            /* ---- 历史记录只读视图 ---- */
            <div className="stock-diag-viewing">
              <div className="stock-diag-viewing-head">
                <button type="button" className="stock-diag-back" onClick={() => setViewing(null)}>← 返回列表</button>
                <span>{new Date(viewing.at).toLocaleString('zh-CN')}</span>
              </div>
              <div className="stock-analysis-summary">
                <div><span>综合评级</span><strong>{viewing.rating}</strong></div>
                <div><span>风险等级</span><strong>{RISK_LABEL[viewing.risk] || viewing.risk || '--'}</strong></div>
                <div><span>分析模式</span><strong>{viewing.mode === 'ai' ? 'AI 增强' : '确定性算法'}</strong></div>
                <div><span>当时现价</span><strong>{viewing.price ?? '--'}</strong></div>
                {viewing.tokens != null && <div><span>Token 消耗</span><strong>{viewing.tokens}</strong></div>}
              </div>
              <div className="stock-ai-text stock-ai-master" dangerouslySetInnerHTML={{ __html: renderMarkdown(viewing.content) }} />
              <div className="stock-diag-viewing-actions">
                <button type="button" className="stock-ai-save" onClick={() => archiveRecord(viewing)} disabled={!onArchiveMaterial}>
                  {ICONS.bookmark}<span>存素材库</span>
                </button>
                <button type="button" className="stock-briefing-history-delete" onClick={() => { ai.deleteDiagnosisRecord(viewing.id); setViewing(null); }} title="删除这条记录">{ICONS.trash}</button>
              </div>
            </div>
          ) : tab === 'history' ? (
            /* ---- 历史记录列表 ---- */
            <div className="stock-diag-history">
              <div className="stock-briefing-history-head">
                <span>本地保存最近 30 条诊断</span>
                <button type="button" disabled={ai.diagnosisHistory.length === 0} onClick={() => window.confirm('确认清空全部诊断历史？') && ai.clearDiagnosisHistory()}>清空</button>
              </div>
              {ai.diagnosisHistory.length === 0 ? (
                <div className="stock-ai-guide"><p>暂无诊断记录。生成一次诊断后，记录会自动留存在这里（含评级与当时价格，可随时回看或存入素材库）。</p></div>
              ) : ai.diagnosisHistory.map(record => (
                <div className="stock-briefing-history-row" key={record.id}>
                  <button type="button" className="stock-briefing-history-open" onClick={() => setViewing(record)}>
                    <strong>{record.name || record.code} {record.rating ? `· ${record.rating}` : ''}</strong>
                    <span>{new Date(record.at).toLocaleString('zh-CN')} · {record.mode === 'ai' ? 'AI 增强' : '算法'} · 现价 {record.price ?? '--'}</span>
                    <p>{String(record.content || '').replace(/[#*\n]/g, ' ').slice(0, 90)}...</p>
                  </button>
                  <button type="button" className="stock-briefing-history-delete" onClick={() => ai.deleteDiagnosisRecord(record.id)} title="删除这条记录">{ICONS.trash}</button>
                </div>
              ))}
            </div>
          ) : (
            /* ---- 诊断报告（原底部 section 内容迁移） ---- */
            <div className="stock-diag-report">
              <div className="stock-ai-panel-actions">
                {!ai.llmReady && <button type="button" className="stock-ai-unready" onClick={onOpenLlmConfig}>配置 AI 增强</button>}
                {diagnosis && (
                  <button type="button" className="stock-ai-save" onClick={archiveDiagnosis} disabled={!onArchiveMaterial}
                    title={onArchiveMaterial ? '保存完整诊断到素材库（含评级 / 指标 / 多空证据）' : '素材库暂不可用'}>
                    {ICONS.bookmark}<span>存素材库</span>
                  </button>
                )}
                {(diagnosis || ai.diagnoseError) && (
                  <button className="stock-ai-rerun" onClick={runDiagnosis} disabled={ai.diagnosing}>{ICONS.refresh}<span>重新分析</span></button>
                )}
              </div>
              {!diagnosis && !ai.diagnosing && !ai.diagnoseError && (
                <button className="stock-ai-run" onClick={runDiagnosis} disabled={!canRun || ai.diagnosing}>
                  {ICONS.sparkle}<span>{ai.llmReady ? '生成 AI 增强分析' : '生成算法分析'}</span>
                </button>
              )}
              {ai.diagnosing && (
                streamText ? (
                  <div className="stock-diag-streaming">
                    <div className="stock-ai-text stock-ai-master" dangerouslySetInnerHTML={{ __html: renderMarkdown(streamText) }} />
                    <div className="stock-diag-streaming-hint"><span className="stock-diag-streaming-dot" />AI 正在逐字生成，可直接阅读…</div>
                  </div>
                ) : (
                  <div className="stock-ai-loading"><div className="spinner" /><span>正在计算技术指标…</span></div>
                )
              )}
              {ai.diagnoseError && <div className="stock-ai-error">{ai.diagnoseError}<button onClick={runDiagnosis}>重试</button></div>}
              {diagnosis && (
                <div className="stock-ai-result stock-analysis-result">
                  <div className="stock-analysis-summary">
                    <div><span>综合评级</span><strong>{diagnosis.rating}</strong></div>
                    <div><span>风险等级</span><strong>{RISK_LABEL[diagnosis.risk] || '--'}</strong></div>
                    <div><span>分析模式</span><strong>{diagnosis.mode === 'ai' ? 'AI 增强' : '确定性算法'}</strong></div>
                    {diagnosis.usage?.total_tokens != null && <div><span>Token 消耗</span><strong>{diagnosis.usage.total_tokens}</strong></div>}
                  </div>
                  {diagnosis.status === 'ready' && (
                    <div className="stock-analysis-metrics">
                      {[
                        { key: 'trend', title: '均线 Trend', items: [
                          ['MA5', diagnosis.metrics.ma5], ['MA10', diagnosis.metrics.ma10], ['MA20', diagnosis.metrics.ma20], ['ATR14', diagnosis.metrics.atr14],
                        ] },
                        { key: 'momentum', title: '动量 Momentum', items: [
                          ['5日动量', diagnosis.metrics.momentum5 == null ? null : `${diagnosis.metrics.momentum5}%`],
                          ['20期涨跌', diagnosis.metrics.assetReturn20 == null ? null : `${diagnosis.metrics.assetReturn20}%`],
                          ['基准同期', diagnosis.metrics.benchmarkReturn20 == null ? null : `${diagnosis.metrics.benchmarkReturn20}%`],
                          ['超额表现', diagnosis.metrics.excessReturn20 == null ? null : `${diagnosis.metrics.excessReturn20}%`],
                        ] },
                        { key: 'risk', title: '风险 Risk', items: [
                          ['最大回撤', diagnosis.metrics.drawdown == null ? null : `${diagnosis.metrics.drawdown}%`],
                          ['波动率', diagnosis.metrics.volatility == null ? null : `${diagnosis.metrics.volatility}%`],
                          ['20期位置', diagnosis.metrics.position20 == null ? null : `${diagnosis.metrics.position20}%`],
                          ['量能', ({ expanding: '放大', contracting: '收缩', stable: '平稳' })[diagnosis.metrics.volumeTrend] || '--'],
                        ] },
                        { key: 'levels', title: '支撑压力 Levels', items: [
                          ['支撑', diagnosis.metrics.support], ['压力', diagnosis.metrics.resistance],
                        ] },
                      ].map(grp => (
                        <section key={grp.key} className="stock-metrics-group">
                          <h6 className="stock-metrics-group-title">{grp.title}</h6>
                          <div className="stock-metrics-rows">
                            {grp.items.map(([label, value]) => {
                              // 涨跌语义：带 % 的数值，正=涨（红）、负=跌（绿），中文市场约定
                              const pct = typeof value === 'string' && value.endsWith('%') ? parseFloat(value) : null;
                              const tone = pct == null || Number.isNaN(pct) || pct === 0 ? '' : pct > 0 ? ' is-up' : ' is-down';
                              return <div key={label}><span>{label}</span><strong className={tone.trim()}>{value ?? '--'}</strong></div>;
                            })}
                          </div>
                        </section>
                      ))}
                    </div>
                  )}
                  {diagnosis.status === 'ready' && (
                    <div className="stock-thesis-grid">
                      {[
                        { key: 'bullish', evidence: diagnosis.bullCase, fallback: '当前序列没有形成明确支持', title: '支持当前判断', sub: '多方证据' },
                        { key: 'bearish', evidence: diagnosis.bearCase, fallback: '当前序列没有形成明确反向信号', title: '反向证据', sub: '空方证据' },
                        { key: 'invalidation', evidence: diagnosis.invalidation, fallback: null, title: '判断失效条件', sub: '必须复核' },
                        { key: 'risk', evidence: diagnosis.riskSignals, fallback: '当前样本未触发额外风险信号', title: '风险实验室', sub: `${diagnosis.dataQuality?.bars || 0} 根 K 线` },
                      ].map(({ key, evidence, fallback, title, sub }) => {
                        const items = Array.isArray(evidence) ? evidence : [];
                        const expanded = !!expandedThesis[key];
                        const showMore = items.length > 1;
                        const visible = expanded ? items : items.slice(0, 1);
                        return (
                          <section key={key} className={`stock-thesis-block ${key}`}>
                            <div className="stock-thesis-head">
                              <strong>{title}</strong>
                              <span className="stock-thesis-count" title={`${items.length} 条要点`}>{items.length}</span>
                              <span className="stock-thesis-sub">{sub}</span>
                              {showMore && (
                                <button type="button" className="stock-thesis-toggle" onClick={() => toggleThesis(key)} aria-expanded={expanded}>
                                  {expanded ? '收起' : `展开 +${items.length - 1}`}
                                </button>
                              )}
                            </div>
                            {items.length > 0 ? (
                              visible.map(item => <p key={item}>{item}</p>)
                            ) : (
                              fallback ? <p className="muted">{fallback}</p> : null
                            )}
                            {key === 'risk' && (
                              <small>比较基准：{diagnosis.dataQuality?.benchmark?.name || '不可用'}；仅基于价格与成交量，未包含财务、公告、资金流和全市场数据。</small>
                            )}
                          </section>
                        );
                      })}
                    </div>
                  )}
                  {experienceMode === 'pro' && diagnosis.status === 'ready' && (
                    <ProCharts klines={diagKlines.length ? diagKlines : (klineData?.klines || [])} diagnosis={diagnosis} />
                  )}
                  {diagnosis.mode === 'ai' && diagnosis.aiNarrative ? (
                    <div className="stock-ai-text stock-ai-master" dangerouslySetInnerHTML={{ __html: renderMarkdown(diagnosis.content || diagnosis.aiNarrative) }} />
                  ) : (
                    <div className="stock-ai-text">{diagnosis.content}</div>
                  )}
                  {diagnosis.aiError && <div className="stock-analysis-fallback">AI 增强失败，当前保留算法结果：{diagnosis.aiError}</div>}
                  <div className="stock-analysis-evidence">
                    {(diagnosis.evidence || []).map(item => <span key={item.key}>{item.label}：{item.value}</span>)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
