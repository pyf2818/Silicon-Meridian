/**
 * trendAnalytics.js — 资讯趋势聚合（纯逻辑，无 React / 无 HTTP）
 *
 * 从 App.jsx 内联 useMemo 抽离（原 App.jsx:1074-1131，58 行）。
 * 抽离理由：
 *  1. 它是纯粹的「items → 图表序列」计算，零 React 耦合，属于 domain 层职责；
 *  2. 原实现内联在 3000 行的 App.jsx 里，且**没有任何测试**——聚合口径（取前 3 赛道、
 *     关键词频次区间 3~8、7 天窗口）一旦被误改，只能靠肉眼看图表发现问题；
 *  3. 抽到 domain 后可就地单测，符合项目「domain 引擎纯逻辑、就地单测」的架构边界。
 */

/** 生成最近 n 天的 YYYY-MM-DD 键（含今天，升序） */
export function buildDayKeys(n, now = new Date()) {
  return Array.from({ length: n }).map((_, idx) => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (n - 1 - idx));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
}

/**
 * 计算资讯趋势面板所需的全部序列。
 *
 * @param {Array<{category?:string, source?:string, tags?:string[], publishedAt?:string}>} items
 * @param {Object} [opts]
 * @param {number} [opts.seriesCount=3] 每条维度取前 N 名作为折线
 * @param {number} [opts.keywordLimit=30] 返回的关键词条目上限
 * @param {number} [opts.emergingMin=3] 「新兴关键词」频次下界
 * @param {number} [opts.emergingMax=8] 「新兴关键词」频次上界
 * @param {number} [opts.windowDays=7] 折线的时间窗天数
 * @param {Date}   [opts.now] 注入当前时间（便于单测，避免依赖系统时钟）
 * @returns {{
 *   categoryStats: Array<[string, {count:number, sources:Set<string>}]>,
 *   sourceStats: Array<[string, {count:number, categories:Set<string>}]>,
 *   topKeywords: Array<[string, number]>,
 *   emergingKeywords: Array<[string, number]>,
 *   dayLabels: string[],
 *   categorySeries: Array<{id:string, values:number[]}>,
 *   sourceSeries: Array<{name:string, values:number[]}>
 * }}
 */
export function computeNewsTrends(items, opts = {}) {
  const {
    seriesCount = 3,
    keywordLimit = 30,
    emergingMin = 3,
    emergingMax = 8,
    windowDays = 7,
    now = new Date(),
  } = opts;

  const list = Array.isArray(items) ? items : [];

  // 按赛道统计
  const categoryStats = new Map();
  list.forEach(item => {
    const cat = categoryStats.get(item.category) || { count: 0, sources: new Set() };
    cat.count += 1;
    cat.sources.add(item.source);
    categoryStats.set(item.category, cat);
  });

  // 按来源统计
  const sourceStats = new Map();
  list.forEach(item => {
    const src = sourceStats.get(item.source) || { count: 0, categories: new Set() };
    src.count += 1;
    src.categories.add(item.category);
    sourceStats.set(item.source, src);
  });

  // 关键词频率（来自 tags）
  const keywordMap = new Map();
  list.forEach(item => {
    item.tags?.forEach(tag => {
      keywordMap.set(tag, (keywordMap.get(tag) || 0) + 1);
    });
  });

  const dayKeys = buildDayKeys(windowDays, now);
  const byDescCount = (a, b) => b[1].count - a[1].count;

  const topCategoryIds = [...categoryStats.entries()].sort(byDescCount).slice(0, seriesCount).map(([id]) => id);
  const categorySeries = topCategoryIds.map(catId => ({
    id: catId,
    values: dayKeys.map(dayKey => list.filter(i => i.category === catId && i.publishedAt?.slice(0, 10) === dayKey).length),
  }));

  const topSources = [...sourceStats.entries()].sort(byDescCount).slice(0, seriesCount).map(([name]) => name);
  const sourceSeries = topSources.map(name => ({
    name,
    values: dayKeys.map(dayKey => list.filter(i => i.source === name && i.publishedAt?.slice(0, 10) === dayKey).length),
  }));

  return {
    categoryStats: [...categoryStats.entries()].sort(byDescCount),
    sourceStats: [...sourceStats.entries()].sort(byDescCount),
    topKeywords: [...keywordMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, keywordLimit),
    emergingKeywords: [...keywordMap.entries()]
      .filter(([, count]) => count >= emergingMin && count <= emergingMax)
      .slice(0, 10),
    dayLabels: dayKeys.map(d => d.slice(5)),
    categorySeries,
    sourceSeries,
  };
}
