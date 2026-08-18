import { getPool, withTransaction } from '../../db/client.js';
import { isDevMemoryMode, intelligenceEvents, intelligenceArticles } from '../../db/devMemoryStore.js';

function articleValues(article) {
  return [
    article.id,
    article.provider || '',
    article.upstreamId || '',
    article.title || '',
    article.titleEn || '',
    article.summary || '',
    article.url || '',
    article.source || '',
    article.sourceUrl || '',
    article.sourceTier || '',
    article.category || 'industry',
    article.categoryLabel || '',
    article.publishedAt || new Date().toISOString(),
    JSON.stringify(article.entities || []),
    JSON.stringify(article.tags || []),
    JSON.stringify({
      heatScore: article.heatScore || 0,
      impactScore: article.impactScore || 0,
      intelligenceScore: article.intelligenceScore || 0,
      scoreParts: article.scoreParts || {},
    }),
    JSON.stringify(article.evidence || {}),
    JSON.stringify(article),
  ];
}

function eventValues(event) {
  return [
    event.id,
    event.title || '',
    event.summary || '',
    event.category || 'industry',
    event.categoryLabel || '',
    event.primaryItemId || null,
    JSON.stringify(event.articleIds || []),
    JSON.stringify(event.entities || []),
    JSON.stringify(event.sources || []),
    event.independentSourceCount || 1,
    event.firstSeenAt || new Date().toISOString(),
    event.lastSeenAt || new Date().toISOString(),
    event.heatScore || 0,
    event.impactScore || 0,
    event.intelligenceScore || 0,
    event.confidence || 0,
    JSON.stringify(event.citations || []),
    JSON.stringify(event.reasons || []),
    JSON.stringify(event),
  ];
}

function mapArticle(row) {
  return {
    id: row.id,
    provider: row.provider,
    upstreamId: row.upstream_id,
    title: row.title,
    titleEn: row.title_en,
    summary: row.summary,
    url: row.url,
    source: row.source,
    sourceUrl: row.source_url,
    sourceTier: row.source_tier,
    category: row.category,
    categoryLabel: row.category_label,
    publishedAt: row.published_at?.toISOString?.() || row.published_at,
    entities: row.entities || [],
    tags: row.tags || [],
    evidence: row.evidence || {},
    ...(row.payload || {}),
  };
}

function mapEvent(row) {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    category: row.category,
    categoryLabel: row.category_label,
    primaryItemId: row.primary_article_id,
    articleIds: row.article_ids || [],
    entities: row.entities || [],
    sources: row.sources || [],
    independentSourceCount: row.independent_source_count,
    firstSeenAt: row.first_seen_at?.toISOString?.() || row.first_seen_at,
    lastSeenAt: row.last_seen_at?.toISOString?.() || row.last_seen_at,
    heatScore: Number(row.heat_score || 0),
    impactScore: Number(row.impact_score || 0),
    intelligenceScore: Number(row.intelligence_score || 0),
    confidence: Number(row.confidence || 0),
    citations: row.citations || [],
    reasons: row.reasons || [],
    ...(row.payload || {}),
  };
}

/**
 * dev 内存兜底实现（DEV_MEMORY_AUTH=true 且非 production）：
 * 与 PG upsert 语义对齐——article 按 id 覆盖并刷新 last_seen_at；
 * event 按 id 合并（articleIds/sources 取并集、firstSeenAt 取更早、lastSeenAt 取更晚，
 * 其余字段以新值为准）。让无 PostgreSQL 的本地环境也能跑通「事件落库 → stored 读取」链路。
 */
function createDevMemoryIntelligenceRepository() {
  const toArticleRow = (article) => ({
    id: article.id,
    provider: article.provider || '',
    upstream_id: article.upstreamId || '',
    title: article.title || '',
    title_en: article.titleEn || '',
    summary: article.summary || '',
    url: article.url || '',
    source: article.source || '',
    source_url: article.sourceUrl || '',
    source_tier: article.sourceTier || '',
    category: article.category || 'industry',
    category_label: article.categoryLabel || '',
    published_at: article.publishedAt || new Date().toISOString(),
    entities: article.entities || [],
    tags: article.tags || [],
    evidence: article.evidence || {},
    payload: { ...article },
  });

  return {
    async upsertArticlesAndEvents({ articles = [], events = [] } = {}) {
      for (const article of articles) {
        const row = toArticleRow(article);
        const existing = intelligenceArticles.get(row.id);
        intelligenceArticles.set(row.id, {
          ...row,
          last_seen_at: new Date().toISOString(),
          payload: { ...(existing?.payload || {}), ...row.payload },
        });
      }
      for (const event of events) {
        const existing = intelligenceEvents.get(event.id);
        const articleIds = [...new Set([...(existing?.articleIds || []), ...(event.articleIds || [])])];
        const sources = [...new Set([...(existing?.sources || []), ...(event.sources || [])])];
        const firstSeenAt = existing?.firstSeenAt && existing.firstSeenAt < (event.firstSeenAt || '')
          ? existing.firstSeenAt
          : (event.firstSeenAt || new Date().toISOString());
        const lastSeenAt = existing?.lastSeenAt && existing.lastSeenAt > (event.lastSeenAt || '')
          ? existing.lastSeenAt
          : (event.lastSeenAt || new Date().toISOString());
        intelligenceEvents.set(event.id, {
          ...(existing || {}),
          ...event,
          articleIds,
          sources,
          independentSourceCount: Math.max(existing?.independentSourceCount || 0, event.independentSourceCount || 1),
          firstSeenAt,
          lastSeenAt,
        });
      }
      return { articles: articles.length, events: events.length };
    },
    async listEvents({ limit = 30, category = '', date = '' } = {}) {
      const boundedLimit = Math.min(200, Math.max(1, Number.parseInt(limit, 10) || 30));
      let rows = [...intelligenceEvents.values()];
      if (category) rows = rows.filter(event => event.category === category);
      if (date && /^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
        rows = rows.filter(event => (event.lastSeenAt || '') >= `${date}T00:00:00.000Z` && (event.lastSeenAt || '') <= `${date}T23:59:59.999Z`);
      }
      return rows
        .sort((a, b) => (b.intelligenceScore || 0) - (a.intelligenceScore || 0)
          || String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || '')))
        .slice(0, boundedLimit);
    },
    async listArticles({ limit = 50 } = {}) {
      const boundedLimit = Math.min(300, Math.max(1, Number.parseInt(limit, 10) || 50));
      return [...intelligenceArticles.values()]
        .sort((a, b) => String(b.published_at || '').localeCompare(String(a.published_at || '')))
        .slice(0, boundedLimit)
        .map(mapArticle);
    },
  };
}

export function createIntelligenceRepository(db) {
  // dev 无 PostgreSQL：走内存兜底（getPool 未被求值，不会 throw DATABASE_UNAVAILABLE）
  if (isDevMemoryMode()) return createDevMemoryIntelligenceRepository();
  const pool = db || getPool();
  return {
    async upsertArticlesAndEvents({ articles = [], events = [] } = {}) {
      return withTransaction(async client => {
        for (const article of articles) {
          await client.query(
            `insert into intelligence_articles (
              id, provider, upstream_id, title, title_en, summary, url, source, source_url, source_tier,
              category, category_label, published_at, entities, tags, scores, evidence, payload
            ) values (
              $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16::jsonb,$17::jsonb,$18::jsonb
            )
            on conflict (id) do update set
              title = excluded.title,
              title_en = excluded.title_en,
              summary = excluded.summary,
              source = excluded.source,
              source_url = excluded.source_url,
              source_tier = excluded.source_tier,
              category = excluded.category,
              category_label = excluded.category_label,
              published_at = excluded.published_at,
              entities = excluded.entities,
              tags = excluded.tags,
              scores = excluded.scores,
              evidence = excluded.evidence,
              payload = excluded.payload,
              last_seen_at = now()`,
            articleValues(article),
          );
        }

        for (const event of events) {
          await client.query(
            `insert into intelligence_events (
              id, title, summary, category, category_label, primary_article_id, article_ids, entities, sources,
              independent_source_count, first_seen_at, last_seen_at, heat_score, impact_score, intelligence_score,
              confidence, citations, reasons, payload
            ) values (
              $1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18::jsonb,$19::jsonb
            )
            on conflict (id) do update set
              title = excluded.title,
              summary = excluded.summary,
              category = excluded.category,
              category_label = excluded.category_label,
              primary_article_id = excluded.primary_article_id,
              article_ids = excluded.article_ids,
              entities = excluded.entities,
              sources = excluded.sources,
              independent_source_count = excluded.independent_source_count,
              first_seen_at = least(intelligence_events.first_seen_at, excluded.first_seen_at),
              last_seen_at = greatest(intelligence_events.last_seen_at, excluded.last_seen_at),
              heat_score = excluded.heat_score,
              impact_score = excluded.impact_score,
              intelligence_score = excluded.intelligence_score,
              confidence = excluded.confidence,
              citations = excluded.citations,
              reasons = excluded.reasons,
              payload = excluded.payload,
              updated_at = now()`,
            eventValues(event),
          );
        }

        return { articles: articles.length, events: events.length };
      });
    },

    async listEvents({ limit = 30, category = '', date = '' } = {}) {
      const boundedLimit = Math.min(200, Math.max(1, Number.parseInt(limit, 10) || 30));
      const params = [boundedLimit];
      let where = '';
      let paramIdx = 1;
      if (category) {
        paramIdx += 1;
        params.push(category);
        where = `where category = $${paramIdx}`;
      }
      if (date && /^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
        paramIdx += 2;
        params.push(`${date}T00:00:00.000Z`, `${date}T23:59:59.999Z`);
        where = `${where ? where + ' and' : 'where'} last_seen_at between $${paramIdx - 1} and $${paramIdx}`;
      }
      const result = await pool.query(
        `select * from intelligence_events ${where}
         order by intelligence_score desc, last_seen_at desc
         limit $1`,
        params,
      );
      return result.rows.map(mapEvent);
    },

    async listArticles({ limit = 50 } = {}) {
      const boundedLimit = Math.min(300, Math.max(1, Number.parseInt(limit, 10) || 50));
      const result = await pool.query('select * from intelligence_articles order by published_at desc limit $1', [boundedLimit]);
      return result.rows.map(mapArticle);
    },
  };
}
