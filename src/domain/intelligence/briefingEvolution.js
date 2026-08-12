/**
 * briefingEvolution.js - 跨日「情报演化」段（G3 复刻 Meridian 的 daily digest 持续追踪）
 *
 * 与项目约定一致：
 * - 纯逻辑、无 React、无 fetch；数据来自 snapshotStore（create/get 存的就是调用方传入的对象）。
 * - 只做 diff：把「今日简报」和「前日快照」的话题清单对比，产出
 *   持续演进 / 今日新增 / 已消退(已解决) 三段，以及一段可直接渲染的 narrative。
 * - 话题 key 容忍标题改写：先用规范化 key 精确匹配，回落到标题词集 Jaccard ≥ 0.6 的近似匹配，
 *   这样"同一事件换了个标题"也能被识别为持续。
 *
 * 接入方式：
 *   - 调用方每日生成简报后，用 saveDailyDigest(store, digestFromBriefing(briefing)) 落盘；
 *   - 次日用 buildBriefingEvolution({ store, todayDigest }) 读前日快照并 diff。
 *   digestFromBriefing 兼容 G2(agenticBriefing) 与现有 briefingEngine 两种形状。
 */

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'by', 'for', 'from', 'in', 'is', 'of', 'on',
  'the', 'to', 'with', 'new', 'today', '的', '了', '和', '与', '在', '是', '及', '对',
]);

// 超通用词（几乎每个科技事件都带，不能作为"同一事件"的判别依据）
const GENERIC_WORDS = new Set([
  '模型', '市场', '技术', '数据', '系统', '报告', '公司', '用户', '产品', '服务',
  '平台', '能力', '版本', '计划', '团队', '行业', '领域', '发展', '支持', '推出',
  '发布', '宣布', '表示', '称',
]);

function normalizeTopic(title = '') {
  return String(title)
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 特征提取（中英混合，容忍改写）：
 *  - 拉丁/数字词（如 OpenAI、GPT-5）：专名与版本号，最稳定。
 *  - 中文字符二元组：中文无空格分词，用相邻字组近似"词"，改写时仍能共享字组。
 *  - 过滤停用词与超通用二元组（模型/市场/技术…），降低噪声。
 */
function extractLatin(text) {
  return (text.match(/[a-z0-9]+(?:[-.][a-z0-9]+)*/gi) || []).map((w) => w.toLowerCase());
}
function cjkBigrams(text) {
  const cjk = text.replace(/[a-z0-9\s]/gi, '');
  const out = [];
  for (let i = 0; i < cjk.length - 1; i += 1) out.push(cjk.slice(i, i + 2));
  return out;
}
function featuresOf(title = '') {
  const norm = normalizeTopic(title);
  const latin = extractLatin(norm).filter((w) => !STOP_WORDS.has(w));
  const bigrams = cjkBigrams(norm).filter((bg) => !GENERIC_WORDS.has(bg));
  return new Set([...latin, ...bigrams]);
}

/** 实体词：含拉丁或数字（专名/英文术语/版本号），同事件改写时最稳定。 */
function isEntityToken(w) {
  return /[a-z0-9]/i.test(w) && !/^[一-龥]+$/.test(w);
}

/** 规范化话题 key：取前 4 个拉丁/数字词，用于稳定精确匹配。 */
export function topicKey(title = '') {
  const latin = extractLatin(normalizeTopic(title)).filter((w) => w.length > 2 && !STOP_WORDS.has(w) && !GENERIC_WORDS.has(w));
  return latin.slice(0, 4).join(' ');
}

/**
 * 两标题是否指向同一事件（容忍改写）：
 *  1) 共享实体词（专名/含数字，如 OpenAI/GPT-5/欧盟）≥ 2；
 *  2) 共享特征（拉丁词 + 中文字组，已过滤通用词）≥ 3；
 *  3) 特征集 Jaccard ≥ 0.5。
 */
export function topicMatch(a = '', b = '') {
  const fa = featuresOf(a);
  const fb = featuresOf(b);
  if (!fa.size || !fb.size) return false;

  let inter = 0;
  let entityShared = 0;
  fa.forEach((w) => {
    if (fb.has(w)) {
      inter += 1;
      if (isEntityToken(w)) entityShared += 1;
    }
  });
  if (entityShared >= 2) return true;
  if (inter >= 3) return true;

  const jaccard = inter / (fa.size + fb.size - inter);
  return jaccard >= 0.5;
}

/**
 * 对比两日话题清单，产出演化三段。
 * @param {Object|null} yesterday  { topics: [{key,title,sourceCount,itemIds}] }
 * @param {Object} today           { topics: [{key,title,sourceCount,itemIds}] }
 * @returns {{ongoing:Array, added:Array, resolved:Array}}
 */
export function diffDigests(yesterday, today) {
  const yTopics = (yesterday?.topics || []).map((t) => ({ ...t, _key: t.key || topicKey(t.title) }));
  const tTopics = (today?.topics || []).map((t) => ({ ...t, _key: t.key || topicKey(t.title) }));

  const matchedToday = new Set();
  const matchedYest = new Set();
  const ongoing = [];

  for (const y of yTopics) {
    for (const t of tTopics) {
      if (matchedToday.has(t._key)) continue;
      if (topicMatch(y.title, t.title)) {
        ongoing.push({
          key: t._key || y._key,
          title: t.title,
          yesterdayTitle: y.title,
          sourceCount: t.sourceCount ?? y.sourceCount,
          itemIds: t.itemIds || y.itemIds || [],
        });
        matchedToday.add(t._key);
        matchedYest.add(y._key);
        break;
      }
    }
  }

  const added = tTopics.filter((t) => !matchedToday.has(t._key));
  const resolved = yTopics.filter((y) => !matchedYest.has(y._key));

  return {
    ongoing: ongoing.map(({ _key, ...rest }) => rest),
    added: added.map(({ _key, ...rest }) => rest),
    resolved: resolved.map(({ _key, ...rest }) => rest),
  };
}

function buildEvolutionNarrative(diff, { prevDate, todayDate }) {
  const parts = [];
  if (!diff.ongoing.length && !diff.added.length && !diff.resolved.length) {
    return `对比 ${prevDate} 与 ${todayDate}：暂无可比事件，今日情报为全新盘面。`;
  }
  if (diff.ongoing.length) {
    parts.push(`持续演进（${diff.ongoing.length}）：${diff.ongoing.map((o) => o.title).join('；')}`);
  }
  if (diff.added.length) {
    parts.push(`今日新增（${diff.added.length}）：${diff.added.map((t) => t.title).join('；')}`);
  }
  if (diff.resolved.length) {
    parts.push(`已消退 / 解决（${diff.resolved.length}）：${diff.resolved.map((y) => y.title).join('；')}`);
  }
  return parts.join('\n');
}

/** 把 'YYYY-MM-DD' 平移 deltaDays 天（按 UTC，避免时区错位）。 */
export function shiftDate(dateStr, deltaDays) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
  if (!m) return dateStr;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + deltaDays);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

/**
 * 把任意简报对象归一为演化所需的 digest（话题清单）。
 * 兼容 G2(agenticBriefing：.clusters[]) 与 briefingEngine(.sections)。
 * @param {Object} briefing
 * @returns {{date:string, topics:Array}}
 */
export function digestFromBriefing(briefing) {
  if (!briefing) return { date: '', topics: [] };
  const date = briefing.date || '';
  let topics = [];

  if (Array.isArray(briefing.clusters)) {
    topics = briefing.clusters.map((c) => ({
      key: c.clusterId,
      title: c.primaryTitle,
      sourceCount: c.sourceCount,
      itemIds: c.itemIds || [],
    }));
  } else if (briefing.sections) {
    const items = [
      briefing.sections.lead,
      ...(briefing.sections.public || []),
      ...(briefing.sections.personal || []),
    ].filter(Boolean);
    topics = items.map((it) => ({ key: it.id, title: it.title, sourceCount: 1, itemIds: [it.id] }));
  }
  return { date, topics };
}

/** 把一日 digest 落盘到 snapshotStore（create 会自动带 version/createdAt/updates）。 */
export function saveDailyDigest(store, digest) {
  if (!store?.create) throw new Error('saveDailyDigest: store 为必填');
  if (!digest?.date) throw new Error('saveDailyDigest: digest.date 为必填');
  return store.create({ ...digest });
}

/**
 * 读前日快照并与今日 digest diff，产出跨日演化段。
 * @param {Object} args
 * @param {Object} args.store        snapshotStore 实例（需 .get）
 * @param {Object} args.todayDigest  digestFromBriefing(briefing) 的结果
 * @param {string} [args.todayDate]  digest.date 优先；缺省用 todayDigest.date
 * @param {number} [args.lookbackDays=1]  往前回看几天（默认 1 天）
 * @returns {{version,mode,todayDate,prevDate,hasPrevious,ongoing,added,resolved,narrative}}
 */
export function buildBriefingEvolution({
  store,
  todayDigest,
  todayDate,
  lookbackDays = 1,
}) {
  if (!store?.get) throw new Error('buildBriefingEvolution: store 为必填');
  const today = todayDate || todayDigest?.date;
  if (!today) throw new Error('buildBriefingEvolution: 需要 todayDate 或 todayDigest.date');

  const prevDate = shiftDate(today, -Math.max(1, Number(lookbackDays || 1)));
  const prev = store.get(prevDate) || null;
  const diff = diffDigests(prev, todayDigest);
  const narrative = buildEvolutionNarrative(diff, { prevDate, todayDate: today });

  return {
    version: 1,
    mode: 'evolution',
    todayDate: today,
    prevDate,
    hasPrevious: !!prev,
    ...diff,
    narrative,
  };
}
