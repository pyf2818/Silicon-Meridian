import { useEffect, useMemo, useState } from 'react';

// 竞争情报监测面板（调研报告 M5 · 轻量 B 端）
// 让用户维护一组「监测词」（竞品 / 赛道 / 技术 / 政策），从当前资讯池中
// 实时聚合命中报道。监测词持久化在 localStorage，纯前端、无后端依赖。
const STORAGE_KEY = 'meridian_monitors';
const CATEGORIES = ['竞品', '赛道', '技术', '政策', '自定义'];

function loadMonitors() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function matchItems(items, keyword) {
  const k = keyword.trim().toLocaleLowerCase();
  if (!k) return [];
  return items.filter(it => {
    const hay = `${it.title || ''} ${it.summary || ''} ${it.source || ''} ${it.author || ''}`.toLocaleLowerCase();
    return hay.includes(k);
  });
}

export default function MonitorPage({ items = [] }) {
  const [monitors, setMonitors] = useState(loadMonitors);
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState('竞品');
  const [detailId, setDetailId] = useState(null); // 点击卡片 → 右侧详情抽屉

  // 详情抽屉：Esc 关闭
  useEffect(() => {
    if (!detailId) return;
    const onKey = e => { if (e.key === 'Escape') setDetailId(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detailId]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(monitors)); } catch { /* localStorage 不可用时忽略 */ }
  }, [monitors]);

  const addMonitor = () => {
    const kw = keyword.trim();
    if (!kw) return;
    if (monitors.some(m => m.keyword.toLocaleLowerCase() === kw.toLocaleLowerCase())) {
      setKeyword('');
      return;
    }
    setMonitors(prev => [...prev, { id: `m_${Date.now()}`, keyword: kw, category }]);
    setKeyword('');
  };

  const removeMonitor = id => setMonitors(prev => prev.filter(m => m.id !== id));

  const computed = useMemo(() =>
    monitors.map(m => {
      const matchedAll = matchItems(items, m.keyword);
      const recent = [...matchedAll]
        .sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0))
        .slice(0, 8);
      return { ...m, matched: recent, count: matchedAll.length };
    }), [monitors, items]);

  const totalMatches = computed.reduce((sum, m) => sum + m.count, 0);

  // 详情抽屉数据：全量命中（卡片里只展示最近 8 条，抽屉里给完整列表）
  const detail = useMemo(() => {
    if (!detailId) return null;
    const m = computed.find(x => x.id === detailId);
    if (!m) return null;
    const all = matchItems(items, m.keyword)
      .sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0));
    return { ...m, all };
  }, [detailId, computed, items]);

  return (
    <div className="monitor-page">
      <header className="monitor-head">
        <div>
          <h1 className="monitor-title">竞争情报监测</h1>
          <p className="monitor-sub">追踪你关心的竞品 / 赛道 / 技术关键词，实时从当前资讯池聚合命中报道</p>
        </div>
        <div className="monitor-stats">
          <div className="monitor-stat">
            <span className="monitor-stat-val">{monitors.length}</span>
            <span className="monitor-stat-label">监测词</span>
          </div>
          <div className="monitor-stat">
            <span className="monitor-stat-val highlight">{totalMatches}</span>
            <span className="monitor-stat-label">命中资讯</span>
          </div>
        </div>
      </header>

      <div className="monitor-add">
        <input
          className="monitor-input"
          placeholder="输入要监测的关键词，如：GPT-5、字节跳动、RAG"
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addMonitor(); }}
        />
        <select className="monitor-select" value={category} onChange={e => setCategory(e.target.value)}>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <button className="monitor-add-btn" onClick={addMonitor}>添加监测</button>
      </div>

      {monitors.length === 0 ? (
        <div className="monitor-empty">
          <p>还没有监测词。添加竞品名 / 赛道关键词，系统会自动从当前资讯池中聚合相关报道。</p>
        </div>
      ) : (
        <div className="monitor-grid">
          {computed.map(m => (
            <section
              key={m.id}
              className={`monitor-card monitor-card--${m.category}${detailId === m.id ? ' active' : ''}`}
              onClick={() => setDetailId(m.id)}
              role="button"
              tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setDetailId(m.id); }}
              title="点击查看命中详情"
            >
              <div className="monitor-card-head">
                <div className="monitor-card-id">
                  <span className="monitor-card-tag">{m.category}</span>
                  <h3 className="monitor-card-keyword">{m.keyword}</h3>
                </div>
                <div className="monitor-card-actions">
                  <span className="monitor-card-count">{m.count} 条</span>
                  <button className="monitor-card-remove" onClick={e => { e.stopPropagation(); removeMonitor(m.id); }} aria-label="移除监测">×</button>
                </div>
              </div>
              {m.matched.length === 0 ? (
                <p className="monitor-card-empty">近期资讯池中暂无命中</p>
              ) : (
                <ul className="monitor-matches">
                  {m.matched.map(it => (
                    <li key={it.id} className="monitor-match">
                      <span className="monitor-match-title">{it.title}</span>
                      <span className="monitor-match-meta">
                        {it.source || '未知来源'}
                        {it.publishedAt ? ` · ${new Date(it.publishedAt).toLocaleDateString('zh-CN')}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}

      {/* 监测详情抽屉：点击卡片弹出，全量命中列表 */}
      {detail && (
        <div className="monitor-drawer-overlay" onClick={() => setDetailId(null)}>
          <aside className="monitor-drawer" onClick={e => e.stopPropagation()} role="dialog" aria-label={`监测详情：${detail.keyword}`}>
            <header className="monitor-drawer-head">
              <div>
                <span className="monitor-card-tag">{detail.category}</span>
                <h3 className="monitor-drawer-title">{detail.keyword}</h3>
              </div>
              <button className="monitor-drawer-close" onClick={() => setDetailId(null)} aria-label="关闭">×</button>
            </header>
            <div className="monitor-drawer-stats">
              <div><strong>{detail.count}</strong><span>累计命中</span></div>
              <div><strong>{detail.all.length}</strong><span>当前资讯池</span></div>
              <div><strong>{detail.all[0] ? new Date(Date.parse(detail.all[0].publishedAt) || Date.now()).toLocaleDateString('zh-CN') : '--'}</strong><span>最近命中</span></div>
            </div>
            <div className="monitor-drawer-body custom-scrollbar">
              {detail.all.length === 0 ? (
                <p className="monitor-card-empty">当前资讯池中暂无命中报道。</p>
              ) : detail.all.map(it => (
                <article key={it.id} className="monitor-drawer-item">
                  <h4 className="monitor-drawer-item-title">{it.title}</h4>
                  {it.summary && <p className="monitor-drawer-item-summary">{it.summary}</p>}
                  <div className="monitor-drawer-item-meta">
                    <span>{it.source || '未知来源'}</span>
                    {it.publishedAt && <span> · {new Date(it.publishedAt).toLocaleDateString('zh-CN')}</span>}
                    {it.url && <a href={it.url} target="_blank" rel="noreferrer">阅读原文 ↗</a>}
                  </div>
                </article>
              ))}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
