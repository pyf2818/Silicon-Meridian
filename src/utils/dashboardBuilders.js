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
export function formatEvolvedAt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${mi}`;
}

/* ============ 领域关注雷达（基于阅读行为真实分布） ============ */

function normalizeKey(str = '') {
  return String(str).toLocaleLowerCase().replace(/[\s_\-]/g, '');
}

/**
 * 领域关注雷达：以关注领域为轴，值 = 该领域阅读点击（匹配 category）占比归一化到 0-100。
 * 若 selectedInterests 为空或阅读行为缺失，回退到 readingHistory 中 top 类目。
 * @param {Array} readingHistory - 阅读点击记录（含 category）
 * @param {Array<string>} selectedInterests - 关注领域标签
 * @param {number} maxAxes - 雷达轴数上限
 * @returns {{ axes: string[], values: number[] }}
 */
export function buildDomainRadar(readingHistory = [], selectedInterests = [], maxAxes = 6) {
  const reads = Array.isArray(readingHistory) ? readingHistory : [];
  const counts = new Map();
  reads.forEach(r => {
    const cat = r?.category || r?.domain;
    if (cat) counts.set(normalizeKey(cat), (counts.get(normalizeKey(cat)) || 0) + 1);
  });

  let axes = [];
  if (Array.isArray(selectedInterests) && selectedInterests.length > 0) {
    axes = selectedInterests.slice(0, maxAxes).map(s => String(s));
  } else {
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxAxes);
    axes = sorted.map(([k]) => k);
  }
  if (axes.length === 0) return { axes: [], values: [] };

  const maxCount = Math.max(1, ...counts.values());
  const values = axes.map(ax => {
    const c = counts.get(normalizeKey(ax)) || 0;
    const v = c > 0 ? Math.round((c / maxCount) * 100) : 8;
    return v;
  });
  return { axes, values };
}

/* ============ 阅读活跃度（按日聚合，最近 N 天） ============ */

/**
 * 阅读活跃度：把 readingHistory 按 readAt 日期聚合，返回最近 days 天的计数序列。
 * @param {Array} readingHistory
 * @param {number} days
 * @returns {{ labels: string[], values: number[] }}
 */
export function buildReadingActivity(readingHistory = [], days = 14) {
  const reads = Array.isArray(readingHistory) ? readingHistory : [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const labels = [];
  const buckets = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    labels.push(`${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    buckets.push(0);
  }
  const indexOf = new Map(labels.map((lab, i) => [lab, i]));
  reads.forEach(r => {
    const t = r?.readAt || r?.timestamp || r?.date;
    if (!t) return;
    const d = new Date(t);
    if (isNaN(d.getTime())) return;
    const lab = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (indexOf.has(lab)) buckets[indexOf.get(lab)] += 1;
  });
  return { labels, values: buckets };
}

/* ============ AI 生成状态柱状图 ============ */

const AI_STATUS_META = {
  generated: { label: '生成成功', color: '#00e5ff' },
  merged: { label: '已合并', color: '#37f5b6' },
  pending: { label: '待处理', color: '#ffb74d' },
  ai_failed: { label: 'AI 失败', color: '#ff6e9c' },
  failed: { label: '失败', color: '#ff5252' },
  unknown: { label: '未知', color: '#9aa7b3' },
};

/**
 * AI 生成状态分布：把 buildAiStatusCounts 的结果转成柱状图 items。
 * @param {Array} snapshots
 * @returns {Array<{ label: string, value: number, color: string }>}
 */
export function buildAiStatusSeries(snapshots = []) {
  const counts = buildAiStatusCounts(snapshots);
  return Object.entries(counts)
    .map(([status, value]) => {
      const meta = AI_STATUS_META[status] || { label: status, color: '#9aa7b3' };
      return { label: meta.label, value, color: meta.color };
    })
    .sort((a, b) => b.value - a.value);
}
