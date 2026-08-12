/**
 * IntelligenceBriefingPanel.jsx - 「复刻 Meridian」G1/G2/G3 的可视化面板
 *
 * 三段式：
 *   1) 跨日演化（G3）：持续 / 新增 / 已消退 Strip
 *   2) 语义事件簇（G1）：按语义（非词法）聚类的今日事件，展示主条目 + 多源数
 *   3) 多智能体分析（G2）：点「生成」后调 LLM 跑多视角分析；未配置大模型时给引导
 *
 * 样式用内联 style（不改动全局 CSS），暗色主题，复用少量既有色板变量。
 */

const panelStyle = {
  margin: '0 0 18px',
  padding: '16px 18px',
  borderRadius: 14,
  border: '1px solid rgba(120,160,200,0.18)',
  background: 'linear-gradient(180deg, rgba(18,26,38,0.72), rgba(12,18,28,0.72))',
  backdropFilter: 'blur(6px)',
  color: '#e8eef6',
};
const titleStyle = { fontSize: 15, fontWeight: 700, margin: '0 0 12px', letterSpacing: 0.5, color: '#cfe3ff' };
const subStyle = { fontSize: 12, color: '#8aa0b8', margin: '0 0 10px' };
const chip = (bg) => ({
  display: 'inline-block',
  padding: '3px 9px',
  margin: '0 6px 6px 0',
  borderRadius: 999,
  fontSize: 12,
  background: bg,
  color: '#e8eef6',
});
const cardStyle = {
  padding: '12px 14px',
  margin: '0 0 10px',
  borderRadius: 10,
  border: '1px solid rgba(120,160,200,0.14)',
  background: 'rgba(255,255,255,0.03)',
};
const btnStyle = {
  marginTop: 8,
  padding: '7px 14px',
  borderRadius: 8,
  border: '1px solid rgba(120,200,255,0.4)',
  background: 'rgba(40,120,200,0.18)',
  color: '#cfe3ff',
  cursor: 'pointer',
  fontSize: 13,
};

export default function IntelligenceBriefingPanel({ briefing }) {
  const {
    todayItems = [],
    semanticClusters = [],
    clustering = false,
    evolution,
    agentic,
    llmStatus = 'idle',
    runAgentic,
  } = briefing || {};

  return (
    <section style={panelStyle} data-testid="intelligence-briefing-panel">
      <h3 style={titleStyle}>🛰️ 今日智能简报 · 语义聚类 + 多智能体 + 跨日演化</h3>
      <p style={subStyle}>
        共 {todayItems.length} 条今日资讯 → 语义聚类 {semanticClusters.length} 个事件簇
        {clustering ? '（聚类中…）' : ''}
      </p>

      {/* G3 跨日演化 */}
      {evolution && (
        <div style={{ ...cardStyle, borderColor: 'rgba(120,200,255,0.25)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#bfe0ff' }}>
            跨日演化（{evolution.prevDate} → {evolution.todayDate}）
          </div>
          {evolution.ongoing?.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <span style={chip('rgba(60,180,120,0.22)')}>持续演进 {evolution.ongoing.length}</span>
              {evolution.ongoing.map((o) => (
                <span key={o.title} style={chip('rgba(60,180,120,0.14)')}>{o.title}</span>
              ))}
            </div>
          )}
          {evolution.added?.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <span style={chip('rgba(80,160,255,0.22)')}>今日新增 {evolution.added.length}</span>
              {evolution.added.map((t) => (
                <span key={t.title} style={chip('rgba(80,160,255,0.14)')}>{t.title}</span>
              ))}
            </div>
          )}
          {evolution.resolved?.length > 0 && (
            <div>
              <span style={chip('rgba(180,120,90,0.22)')}>已消退/解决 {evolution.resolved.length}</span>
              {evolution.resolved.map((r) => (
                <span key={r.title} style={chip('rgba(180,120,90,0.14)')}>{r.title}</span>
              ))}
            </div>
          )}
          {!evolution.hasPrevious && (
            <div style={subStyle}>首日报送，暂无前日快照可对比。</div>
          )}
        </div>
      )}

      {/* G1 语义事件簇 */}
      <div style={{ marginTop: 12 }}>
        {semanticClusters.length === 0 && !clustering && (
          <div style={subStyle}>今日暂无可聚类的资讯。</div>
        )}
        {semanticClusters.slice(0, 8).map((c) => (
          <div key={c.id} style={cardStyle}>
            <div style={{ fontWeight: 600, color: '#e8eef6' }}>{c.primaryItem?.title || '(未命名事件)'}</div>
            <div style={subStyle}>
              {c.items.length} 篇报道 · {c.independentSourceCount} 个独立来源 · 聚类方式：语义(embeddings)
            </div>
            <div>
              {c.items.slice(0, 4).map((it) => (
                <span key={it.id} style={chip('rgba(120,160,200,0.12)')}>{it.source || '未知'}</span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* G2 多智能体分析 */}
      <div style={{ marginTop: 14 }}>
        <button type="button" style={btnStyle} onClick={runAgentic} disabled={llmStatus === 'running'}>
          {llmStatus === 'running' ? '多智能体分析中…' : '生成多智能体分析'}
        </button>
        {llmStatus === 'no-config' && (
          <div style={{ ...subStyle, color: '#e0b070', marginTop: 8 }}>
            未配置大模型：请先在设置中填写 baseUrl / 模型，即可生成多视角分析。
          </div>
        )}
        {llmStatus === 'error' && (
          <div style={{ ...subStyle, color: '#e08080', marginTop: 8 }}>分析生成失败，请检查大模型配置或稍后重试。</div>
        )}
        {agentic && (
          <div style={{ marginTop: 10 }}>
            {agentic.clusters.map((ac) => (
              <div key={ac.clusterId} style={{ ...cardStyle, borderColor: 'rgba(120,200,255,0.22)' }}>
                <div style={{ fontWeight: 600, marginBottom: 6, color: '#bfe0ff' }}>{ac.primaryTitle}</div>
                {ac.views.map((v) => (
                  <div key={v.viewLabel} style={{ fontSize: 12, color: '#a9bcd0', marginBottom: 3 }}>
                    <b style={{ color: '#cfe3ff' }}>{v.viewLabel}：</b>
                    {String(v.output).slice(0, 120)}
                  </div>
                ))}
                {ac.synthesis && (
                  <div style={{ fontSize: 12, color: '#cfe3ff', marginTop: 4 }}>↳ 合成：{String(ac.synthesis).slice(0, 120)}</div>
                )}
              </div>
            ))}
            {agentic.total && (
              <div style={{ ...cardStyle, borderColor: 'rgba(120,200,255,0.3)' }}>
                <div style={{ fontWeight: 600, marginBottom: 4, color: '#bfe0ff' }}>总览</div>
                <div style={{ fontSize: 12, color: '#cfe3ff' }}>{String(agentic.total).slice(0, 200)}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
