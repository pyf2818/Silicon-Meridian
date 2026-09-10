// localStorage utilities extracted from App.jsx

/**
 * 读取并解析 localStorage。
 *
 * v26.9e 自愈规则：若 `fallback` 是数组，则解析结果**必须也是数组**，否则回落 fallback。
 * 背景：存量 key（articles / customSources / stockWatchlist …）一旦被旧版本或手工编辑写成了
 * 对象，下游 `arr.some(...)` / `arr.length` 会直接抛 TypeError 并把整站打崩——
 * 与 behaviorStore 的 `readingHistory.filter is not a function` 是同一类事故。
 * 用 fallback 的形状做契约，零调用点改动即可兜住。
 */
export function loadLS(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    if (!v) return fallback;
    const parsed = JSON.parse(v);
    if (Array.isArray(fallback) && !Array.isArray(parsed)) return fallback;
    if (key === 'bookmarks' && Array.isArray(parsed)) return parsed.map(b => ({ ...b, isRead: b.isRead ?? false, readAt: b.readAt || null, mode: b.mode || 'flash', region: b.region || 'overseas', tags: b.tags || [], category: b.category || '', summary: b.summary || '' }));
    return parsed;
  } catch { return fallback; }
}

export function saveLS(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

export function clearStaleLS() {
  ['summaryCache'].forEach(key => {
    try {
      const v = localStorage.getItem(key);
      if (v) {
        const parsed = JSON.parse(v);
        if (typeof parsed !== 'object' || parsed === null) localStorage.removeItem(key);
      }
    } catch { localStorage.removeItem(key); }
  });
}
