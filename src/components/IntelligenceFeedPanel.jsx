import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNewsPreviewStore } from '../store/newsPreviewStore.js';

function formatScore(value) {
  const score = Number(value || 0);
  return Number.isFinite(score) ? Math.round(score) : 0;
}

function formatRelativeTime(value, t) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return t('common.unknown');
  const diffMs = Date.now() - time;
  const minutes = Math.max(0, Math.floor(diffMs / 60000));
  if (minutes < 60) return t('news.minutesAgo', { count: minutes || 1 });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('news.hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t('news.daysAgo', { count: days });
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(time));
}

/** 由事件数据合成确定性「情报解读」——不依赖 LLM，点击预览时随 item 传入抽屉展示 */
export function buildIntelInsight(event) {
  if (!event) return null;
  const impact = formatScore(event.impactScore);
  const heat = formatScore(event.heatScore);
  const score = formatScore(event.intelligenceScore);
  const sourceCount = Number(event.independentSourceCount || (event.sources || []).length || 0);
  const confidence = formatScore(event.confidence);
  const lines = [];
  // 维度解读：影响 vs 热度的关系是判断「实质 vs 炒作」的核心线索
  if (impact && heat) {
    if (impact >= heat) lines.push(`影响力 ${impact} 高于热度 ${heat}：属于实质导向的信号，市场注意力尚未饱和，值得优先跟进。`);
    else lines.push(`热度 ${heat} 高于影响力 ${impact}：话题性强但实质含量待甄别，建议先看多源报道再下判断。`);
  }
  // 信源结构
  if (sourceCount >= 3) lines.push(`已有 ${sourceCount} 家独立信源报道，交叉验证充分（置信度约 ${confidence}%），事实基础较扎实。`);
  else if (sourceCount === 2) lines.push(`目前 ${sourceCount} 家信源，初步互证；关键细节仍以官方公告为准。`);
  else if (sourceCount === 1) lines.push(`仅单一信源，早期信号；持续观察是否有跟进报道。`);
  // GDELT 全球媒体交叉佐证（Batch3 元数据，缺失则跳过）
  if (event.verification) {
    const v = event.verification;
    lines.push(`GDELT 交叉佐证：${v.distinctDomains} 家独立域名报道（${v.level === 'strong' ? '强佐证' : '部分佐证'}）。`);
  }
  // 关注理由
  (event.reasons || []).slice(0, 2).forEach(r => lines.push(String(r)));
  // 实体
  const entities = (event.entities || []).filter(Boolean).slice(0, 5);
  return {
    headline: `综合评分 ${score} ｜ 影响 ${impact || '--'} · 热度 ${heat || '--'}`,
    lines,
    entities,
  };
}

/** 事件 → 资讯预览 payload（复用 NewsPreviewPanel 抽屉，抓取原文 + 附带情报解读） */
function eventToPreview(event) {
  const citation = (event.citations || [])[0] || {};
  return {
    id: event.id,
    title: event.title,
    summary: event.summary,
    source: citation.source || (event.sources || [])[0] || '',
    url: citation.url || event.url || '',
    publishedAt: citation.publishedAt || event.lastSeenAt,
    imageUrl: '',
    insight: buildIntelInsight(event),
  };
}

/**
 * IntelligenceFeedPanel - 精准推荐顶部「今日行业情报雷达」
 *
 * v21 重设计：从单条 Hero 改为「榜首主卡 + 值得关注信号列表」，
 * 每条都可点击 → 右侧预览抽屉（原文全文 + 情报解读）。
 * 视觉与项目 HUD 语言对齐：青色 accent、扫描线、评分环、条形指标。
 */
export default function IntelligenceFeedPanel({
  items = [],
  opportunities = [],
  weeklySectors = null,
  alerts = [],
  loading = false,
  error = '',
  updatedAt = '',
  onRefresh,
}) {
  const { t } = useTranslation();
  const openNewsPreview = useNewsPreviewStore(s => s.open);

  // 按综合评分排序取前 5：榜首为主卡，2-5 名进「值得关注」列表
  const ranked = useMemo(() => {
    if (!items.length) return [];
    return [...items].sort((a, b) => Number(b.intelligenceScore || 0) - Number(a.intelligenceScore || 0)).slice(0, 5);
  }, [items]);
  const hero = ranked[0] || null;
  const rest = ranked.slice(1);

  // 关键提醒条：仅展示优先级最高的 1 条（避免视觉噪声）
  const topAlert = useMemo(() => {
    if (!Array.isArray(alerts) || alerts.length === 0) return null;
    return alerts.reduce((top, cur) =>
      Number(cur.priority || 0) > Number(top.priority || 0) ? cur : top
    , alerts[0]);
  }, [alerts]);

  return (
    <section className="intelligence-feed-panel" aria-label={t('intelligence.title')}>
      <header className="intelligence-feed-head">
        <div>
          <span className="intelligence-feed-kicker">{t('intelligence.kicker')}</span>
          <h2>{t('intelligence.title')}</h2>
        </div>
        <div className="intelligence-feed-actions">
          {updatedAt && <span>{formatRelativeTime(updatedAt, t)}{t('intelligence.updatedAt')}</span>}
          <button type="button" onClick={onRefresh} disabled={loading} aria-label={t('intelligence.refresh')}>
            {loading ? t('common.refreshing') : t('intelligence.refresh')}
          </button>
        </div>
      </header>

      {error && (
        <div className="intelligence-feed-error">
          <strong>{t('errors.serverError')}</strong>
          <span>{error}</span>
        </div>
      )}

      {!error && loading && !hero && (
        <div className="intelligence-feed-skeleton">
          {Array.from({ length: 1 }).map((_, index) => <span key={index} />)}
        </div>
      )}

      {!error && !loading && !hero && (
        <div className="intelligence-feed-empty">{t('intelligence.noData')}</div>
      )}

      {/* 关键提醒条：仅 1 条最高优先级，避免多条堆砌 */}
      {topAlert && (
        <div className="intelligence-alert-strip" aria-label={t('intelligence.alertReminder')}>
          <div className={`intelligence-alert intelligence-alert-${topAlert.kind || 'priority'}`}>
            <span>{topAlert.kind === 'risk' ? t('intelligence.alertRisk') : topAlert.kind === 'opportunity' ? t('intelligence.alertOpportunity') : topAlert.kind === 'sector' ? t('intelligence.alertSector') : t('intelligence.alertReminder')}</span>
            <strong>{topAlert.title}</strong>
            <em>{formatScore(topAlert.priority)}</em>
          </div>
        </div>
      )}

      {/* 雷达榜首：最值得关注的主卡，点击打开预览 + 情报解读 */}
      {hero && (
        <article className="intel-radar-lead" onClick={() => openNewsPreview(eventToPreview(hero))} role="button" tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter') openNewsPreview(eventToPreview(hero)); }} title="点击查看全文与情报解读">
          <div className="intel-radar-lead-score" aria-hidden="true" style={{ '--score': Math.min(100, formatScore(hero.intelligenceScore)) }}>
            <span>{formatScore(hero.intelligenceScore)}</span>
            <small>综合</small>
          </div>
          <div className="intel-radar-lead-main">
            <div className="intel-radar-chips">
              <span className="intel-radar-chip rank">{formatScore(hero.impactScore)} 影响 · {formatScore(hero.heatScore)} 热度</span>
              {hero.categoryLabel && <span className="intel-radar-chip">{hero.categoryLabel}</span>}
              {hero.independentSourceCount > 1 && <span className="intel-radar-chip">{hero.independentSourceCount} 源互证</span>}
              {hero.verification && (
                <span
                  className={`intel-radar-chip verify-${hero.verification.level === 'strong' ? 'strong' : 'partial'}`}
                  title={`GDELT 全球媒体交叉验证：${hero.verification.distinctDomains} 家独立域名报道`}
                >
                  ✓ GDELT {hero.verification.distinctDomains} 域
                </span>
              )}
            </div>
            <h3 className="intel-radar-lead-title">{hero.title}</h3>
            <p className="intel-radar-lead-summary">{hero.summary || t('common.empty')}</p>
            <footer className="intel-radar-lead-foot">
              <span>{hero.source || t('common.unknown')} · {formatRelativeTime(hero.publishedAt, t)}</span>
              <em>查看全文与解读 →</em>
            </footer>
          </div>
        </article>
      )}

      {/* 雷达榜单：2-5 名值得关注的信号，点击同样进预览 */}
      {rest.length > 0 && (
        <div className="intel-radar-list">
          <div className="intel-radar-list-title">今日值得关注 · TOP {ranked.length}</div>
          {rest.map((event, index) => (
            <button type="button" key={event.id} className="intel-radar-row" onClick={() => openNewsPreview(eventToPreview(event))} title="点击查看全文与情报解读">
              <span className="intel-radar-row-rank">{String(index + 2).padStart(2, '0')}</span>
              <span className="intel-radar-row-main">
                <span className="intel-radar-row-title">{event.title}</span>
                <span className="intel-radar-row-meta">
                  {event.categoryLabel && <i>{event.categoryLabel}</i>}
                  {event.independentSourceCount > 1 && <i>{event.independentSourceCount} 源</i>}
                  {event.verification && <i className="intel-verify" title="GDELT 全球媒体交叉验证">✓{event.verification.distinctDomains}域</i>}
                  <i>{event.source || ''}</i>
                </span>
              </span>
              <span className="intel-radar-row-bars" aria-hidden="true">
                <span className="intel-radar-bar"><i style={{ width: `${Math.min(100, formatScore(event.impactScore))}%` }} data-kind="impact" /></span>
                <span className="intel-radar-bar"><i style={{ width: `${Math.min(100, formatScore(event.heatScore))}%` }} data-kind="heat" /></span>
              </span>
              <span className="intel-radar-row-score">{formatScore(event.intelligenceScore)}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
