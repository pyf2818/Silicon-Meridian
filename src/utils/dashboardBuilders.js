// src/utils/dashboardBuilders.js
// Phase 4 D2: 仪表盘纯函数（从 useProfileDashboard hook 抽取，便于单元测试）
// 不依赖 React / store，纯数据转换

/**
 * 趋势图数据：每日推荐数
 * @param {Array} snapshots - GET /api/profile/snapshots 返回的快照列表
 * @returns {{ labels: string[], series: Array<{ name: string, values: number[] }> }}
 */
export function buildTrendSeries(snapshots = []) {
  const labels = snapshots.map(s => (s.snapshot_date || '').slice(5));
  const values = snapshots.map(s => Number(s.item_count) || 0);
  return { labels, series: [{ name: '每日推荐数', values }] };
}

/**
 * ai_status 分布统计
 * @param {Array} snapshots - 快照列表
 * @returns {Record<string, number>} { generated: 5, merged: 3, ai_failed: 1, ... }
 */
export function buildAiStatusCounts(snapshots = []) {
  return snapshots.reduce((acc, s) => {
    const status = s.ai_status || 'unknown';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
}
