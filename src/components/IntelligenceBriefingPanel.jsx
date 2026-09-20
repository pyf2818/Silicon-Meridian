/**
 * IntelligenceBriefingPanel.jsx - 「复刻 Meridian」G1/G2/G3 的可视化面板
 *
 * 三段式：
 *   1) 跨日演化（G3）：持续 / 新增 / 已消退 Strip
 *   2) 语义事件簇（G1）：按语义（非词法）聚类的今日事件，展示主条目 + 多源数
 *   3) 多智能体分析（G2）：点「生成」后调 LLM 跑多视角分析；未配置大模型时给引导
 *
 * 样式改走 src/intelligence-briefing.css（报纸风，与今日速报一致），不再使用暗色玻璃内联样式。
 */

export default function IntelligenceBriefingPanel({ briefing, maxClusters = 8 }) {
  const {
    todayItems = [],
    semanticClusters = [],
    clustering = false,
    evolution,
    agentic,
    llmStatus = 'idle',
    g2Progress = null,
    runAgentic,
  } = briefing || {};

  // 「适当筛选」：只展示 ≥2 篇报道的多源事件簇（剔除单条噪声），按规模排序取前 N，
  // 标题仍保留真实聚类总数，便于用户了解当日信息覆盖广度。
  const shownClusters = semanticClusters
    .filter((c) => (c.items?.length || 0) >= 2)
    .slice(0, maxClusters);

  return (
    <section className="intel-briefing" data-testid="intelligence-briefing-panel">
      <header className="intel-briefing-head">
        <span className="intel-briefing-eyebrow">INTELLIGENCE BRIEFING · 复刻 Meridian G1/G2/G3</span>
        <h3 className="intel-briefing-title">今日智能简报 · 语义聚类 + 多智能体 + 跨日演化</h3>
        <p className="intel-briefing-sub">
          共 {todayItems.length} 条今日资讯 → 语义聚类 {semanticClusters.length} 个事件簇
          {clustering ? '（聚类中…）' : ''}
          {shownClusters.length < semanticClusters.length && ` · 精选 ${shownClusters.length} 个多源事件`}
        </p>
      </header>

      {/* G3 跨日演化（固定窗口滚动，避免内容过长撑爆面板） */}
      {evolution && (
        <div className="intel-card intel-card--accent">
          <div className="intel-section-label">跨日演化（{evolution.prevDate} → {evolution.todayDate}）</div>
          <div className="intel-evolution-scroll">
            {evolution.ongoing?.length > 0 && (
              <div>
                <span className="intel-chip intel-chip--lead">持续演进 {evolution.ongoing.length}</span>
                {evolution.ongoing.map((o) => (
                  <span key={o.title} className="intel-chip intel-chip--ok">{o.title}</span>
                ))}
              </div>
            )}
            {evolution.added?.length > 0 && (
              <div>
                <span className="intel-chip intel-chip--lead">今日新增 {evolution.added.length}</span>
                {evolution.added.map((t) => (
                  <span key={t.title} className="intel-chip intel-chip--new">{t.title}</span>
                ))}
              </div>
            )}
            {evolution.resolved?.length > 0 && (
              <div>
                <span className="intel-chip intel-chip--lead">已消退/解决 {evolution.resolved.length}</span>
                {evolution.resolved.map((r) => (
                  <span key={r.title} className="intel-chip intel-chip--warn">{r.title}</span>
                ))}
              </div>
            )}
            {!evolution.hasPrevious && (
              <p className="intel-briefing-sub">首日报送，暂无前日快照可对比。</p>
            )}
          </div>
        </div>
      )}

      {/* G1 语义事件簇 */}
      <div className="intel-clusters">
        {semanticClusters.length === 0 && !clustering && (
          <p className="intel-briefing-sub">今日暂无可聚类的资讯。</p>
        )}
        {semanticClusters.length > 0 && shownClusters.length === 0 && !clustering && (
          <p className="intel-briefing-sub">今日多数为单条资讯，暂无可合并的多源事件。</p>
        )}
        {shownClusters.map((c) => (
          <div key={c.id} className="intel-cluster">
            <div className="intel-cluster-head">
              <div className="intel-cluster-title">{c.primaryItem?.title || '(未命名事件)'}</div>
              {c.independentSourceCount >= 2 && (
                <span className="intel-badge intel-badge--verified" title={`${c.independentSourceCount} 个独立来源交叉验证`}>
                  ✓ {c.independentSourceCount} 源印证
                </span>
              )}
            </div>
            <div className="intel-cluster-meta">
              {c.items.length} 篇报道 · {c.independentSourceCount} 个独立来源 · 聚类方式：语义(embeddings)
            </div>
            <div className="intel-chips">
              {c.items.slice(0, 4).map((it) => (
                <span key={it.id} className="intel-chip">{it.source || '未知'}</span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* G2 多智能体分析 */}
      <div className="intel-agentic">
        <button type="button" className="intel-btn" onClick={runAgentic} disabled={llmStatus === 'running'}>
          {llmStatus === 'running' ? '多智能体分析中…' : '生成多智能体分析'}
        </button>
        {llmStatus === 'running' && g2Progress && (
          <div className="intel-g2-progress">
            <div className="intel-g2-progress-step">第 {g2Progress.seq} 步：{g2Progress.preview}…</div>
            {g2Progress.output && <div className="intel-g2-progress-output">{String(g2Progress.output).slice(-160)}</div>}
          </div>
        )}
        {llmStatus === 'no-config' && (
          <p className="intel-note intel-note--warn">
            未配置大模型：请先在设置中填写 baseUrl / 模型，即可生成多视角分析。
          </p>
        )}
        {llmStatus === 'error' && (
          <p className="intel-note intel-note--err">分析生成失败，请检查大模型配置或稍后重试。</p>
        )}
        {agentic && (
          <div className="intel-agentic-results">
            {agentic.clusters.map((ac) => (
              <div key={ac.clusterId} className="intel-card intel-card--accent">
                <div className="intel-cluster-title">{ac.primaryTitle}</div>
                {ac.views.map((v) => (
                  <div key={v.viewLabel} className="intel-view">
                    <b className="intel-view-label">{v.viewLabel}：</b>
                    <span>{String(v.output).slice(0, 120)}</span>
                  </div>
                ))}
                {ac.synthesis && (
                  <div className="intel-synthesis">↳ 合成：{String(ac.synthesis).slice(0, 120)}</div>
                )}
              </div>
            ))}
            {agentic.total && (
              <div className="intel-card intel-card--strong">
                <div className="intel-section-label">总览</div>
                <div className="intel-total">{String(agentic.total).slice(0, 200)}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
