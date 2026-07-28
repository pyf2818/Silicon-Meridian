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

/**
 * 把任意错误对象规整为字符串，避免 React 渲染对象导致
 * "Objects are not valid as a React child" 运行时错误
 * 接受：string | Error | {code, message} | {error: ...} | 任意
 * @param {*} err
 * @returns {string}
 */
export function normalizeError(err) {
  if (err == null) return '';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message || String(err);
  if (typeof err === 'object') {
    if (typeof err.message === 'string') return err.message;
    if (typeof err.error === 'string') return err.error;
    if (typeof err.code === 'string') return err.code;
    try { return JSON.stringify(err); } catch { return String(err); }
  }
  return String(err);
}

/* ============ Phase 5: personaSummary 进化趋势 ============ */

/**
 * 趋势图数据：persona 数组长度随时间变化
 * @param {Array<{ snapshot?: { habits?: any[], traits?: any[], needs?: any[] }, evolved_at?: string }>} history - API 返回的 DESC 历史列表
 * @returns {{ labels: string[], series: Array<{ name: string, values: number[] }> }}
 */
export function buildPersonaTrendSeries(history = []) {
  if (!Array.isArray(history)) return { labels: [], series: [
    { name: '习惯', values: [] },
    { name: '性格', values: [] },
    { name: '需求', values: [] },
  ] };
  // 倒序（DESC）转正序（ASC），X 轴从左到右时间递进
  const sorted = [...history].reverse();
  return {
    labels: sorted.map(h => formatEvolvedAt(h.evolved_at)),
    series: [
      { name: '习惯', values: sorted.map(h => Array.isArray(h?.snapshot?.habits) ? h.snapshot.habits.length : 0) },
      { name: '性格', values: sorted.map(h => Array.isArray(h?.snapshot?.traits) ? h.snapshot.traits.length : 0) },
      { name: '需求', values: sorted.map(h => Array.isArray(h?.snapshot?.needs) ? h.snapshot.needs.length : 0) },
    ],
  };
}

/**
 * 两个快照的 diff（新增/删除项）
 * @param {{ habits?: any[], traits?: any[], needs?: any[] }|undefined} prev
 * @param {{ habits?: any[], traits?: any[], needs?: any[] }|undefined} current
 * @returns {{ habits: { added: any[], removed: any[] }, traits: { added: any[], removed: any[] }, needs: { added: any[], removed: any[] } }}
 */
export function diffPersonaSnapshots(prev = {}, current = {}) {
  const diffList = (key) => {
    const prevArr = Array.isArray(prev?.[key]) ? prev[key] : [];
    const curArr = Array.isArray(current?.[key]) ? current[key] : [];
    const prevSet = new Set(prevArr.map(x => String(x)));
    const curSet = new Set(curArr.map(x => String(x)));
    return {
      added: curArr.filter(x => !prevSet.has(String(x))),
      removed: prevArr.filter(x => !curSet.has(String(x))),
    };
  };
  return {
    habits: diffList('habits'),
    traits: diffList('traits'),
    needs: diffList('needs'),
  };
}

/**
 * 格式化 evolved_at 为 "MM-DD HH:mm"（X 轴 label，UTC 解析保证跨时区一致）
 * @param {string} iso - ISO 时间字符串
 * @returns {string}
 */
function formatEvolvedAt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${mi}`;
}
