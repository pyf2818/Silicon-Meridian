/**
 * 资讯质量报表（P0 度量地基）。
 *
 * 用法：
 *   node scripts/quality-report.mjs                          # 打 http://127.0.0.1:5175
 *   node scripts/quality-report.mjs --url http://127.0.0.1:5175
 *   node scripts/quality-report.mjs --json                   # 机器可读输出
 *
 * 回答的问题（没有这些数字，任何调参都是玄学）：
 *   1. 时效性：可见条目的发布时间分布；估计时间（信源未给日期）占比
 *   2. 真实性：交叉验证分布（多少条只有单一来源）
 *   3. 多样性：来源集中度（TOP-10 来源占了多少屏）
 *   4. 影子对比：统一排序内核（ranker-v2.1）与现行质量排序的 TOP-10 重合度、升降级清单
 *
 * 注意：这是**只读报表**，不改变任何行为。
 */
import { rankItems, compareOrders } from '../server/ranking/ranker.js';

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const readOption = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const BASE = readOption('--url', 'http://127.0.0.1:5175').replace(/\/$/, '');
const PAGE = 500;
const now = Date.now();
const parse = v => new Date(v ?? '').getTime();

async function fetchAll() {
  const first = await (await fetch(`${BASE}/api/news?page=0&pageSize=${PAGE}`)).json();
  const items = [...(first.items || [])];
  const totalPages = Math.min(Math.ceil((first.total || items.length) / PAGE), 4);
  for (let page = 1; page < totalPages; page += 1) {
    const res = await fetch(`${BASE}/api/news?page=${page}&pageSize=${PAGE}`);
    if (!res.ok) break;
    const data = await res.json();
    items.push(...(data.items || []));
  }
  return items;
}

function bucket(ms) {
  const hours = ms / 3_600_000;
  if (hours < 1) return '<1h';
  if (hours < 6) return '1-6h';
  if (hours < 24) return '6-24h';
  if (hours < 24 * 7) return '1-7d';
  return '>7d';
}

const items = await fetchAll();
if (!items.length) {
  console.error('没有取到任何资讯——dev server 是否在跑？');
  process.exit(1);
}

// ---- 时效性 ----
const estimated = items.filter(i => i.publishedAtEstimated === true);
const withDate = items.filter(i => i.publishedAt);
const buckets = {};
for (const item of withDate) {
  const elapsed = now - parse(item.publishedAt);
  if (!Number.isFinite(elapsed)) continue;
  const key = bucket(elapsed);
  buckets[key] = (buckets[key] || 0) + 1;
}

// ---- 真实性 ----
const corroboration = {};
for (const item of items) {
  const count = item.independentSourceCount ?? 0;
  const key = count >= 4 ? '4+' : String(count);
  corroboration[key] = (corroboration[key] || 0) + 1;
}

// ---- 多样性 ----
const bySource = new Map();
for (const item of items) bySource.set(item.source, (bySource.get(item.source) || 0) + 1);
const sourceRanking = [...bySource].sort((a, b) => b[1] - a[1]);
const top10Share = sourceRanking.slice(0, 10).reduce((sum, [, n]) => sum + n, 0) / items.length;

// ---- 影子对比 ----
const ranked = rankItems(items, { lane: 'public', now });
const shadow = compareOrders(items, ranked, { topN: 10 });
const newTop10 = ranked.slice(0, 10).map(item => `${item.source} · ${String(item.title).slice(0, 36)}`);

// ---- 数据完整性：重复 id（会破坏前端 key 与影子对比的可信度） ----
const idCounts = new Map();
for (const item of items) {
  const key = String(item.id ?? '');
  idCounts.set(key, (idCounts.get(key) || 0) + 1);
}
const duplicatedIds = [...idCounts].filter(([, n]) => n > 1);

const report = {
  generatedAt: new Date().toISOString(),
  sample: items.length,
  integrity: {
    duplicateIdItems: duplicatedIds.reduce((sum, [, n]) => sum + n, 0),
    duplicateIdExamples: duplicatedIds.slice(0, 5).map(([id, n]) => ({ id, n })),
  },
  freshness: {
    estimatedNoDateRatio: Number((estimated.length / items.length).toFixed(3)),
    buckets: Object.fromEntries(['<1h', '1-6h', '6-24h', '1-7d', '>7d'].map(key => [key, buckets[key] || 0])),
  },
  corroboration: Object.fromEntries(['1', '2', '3', '4+'].map(key => [key, corroboration[key] || 0])),
  diversity: {
    distinctSources: sourceRanking.length,
    top10Share: Number(top10Share.toFixed(3)),
    top10Sources: sourceRanking.slice(0, 10).map(([source, count]) => ({ source, count })),
  },
  shadow: {
    rankerVersion: ranked[0]?.rankVersion,
    top10Overlap: shadow.overlapCount,
    promoted: shadow.promoted,
    demoted: shadow.demoted,
    newTop10: newTop10,
  },
};

if (flag('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('========== 资讯质量报表 ==========');
  console.log(`样本 ${items.length} 条 @ ${report.generatedAt}`);
  console.log(`\n[时效性] 信源未提供日期: ${estimated.length} 条（${(report.freshness.estimatedNoDateRatio * 100).toFixed(1)}%）`);
  for (const key of ['<1h', '1-6h', '6-24h', '1-7d', '>7d']) {
    const count = report.freshness.buckets[key];
    const bar = '█'.repeat(Math.round((count / items.length) * 40));
    console.log(`  ${key.padEnd(6)} ${String(count).padStart(4)}  ${bar}`);
  }
  console.log('\n[真实性] 独立来源数分布:');
  for (const key of ['1', '2', '3', '4+']) {
    console.log(`  ${key.padEnd(3)} ${String(report.corroboration[key]).padStart(4)} 条`);
  }
  console.log(`\n[多样性] 去重来源 ${sourceRanking.length} 个；TOP-10 来源占 ${(top10Share * 100).toFixed(0)}%`);
  sourceRanking.slice(0, 5).forEach(([source, count]) => console.log(`  ${source} ×${count}`));
  console.log(`\n[数据完整性] 重复 id 条目: ${report.integrity.duplicateIdItems} 条`);
  report.integrity.duplicateIdExamples.forEach(({ id, n }) => console.log(`  ${id} ×${n}`));
  console.log(`\n[影子对比] ranker-v2.1 vs 现行排序：TOP-10 重合 ${shadow.overlapCount}/10`);
  if (shadow.promoted.length) {
    console.log('  新内核会提权（旧排序看不到前 10）:');
    shadow.promoted.forEach(p => console.log(`   ↑ ${p.rankScore} 分 | ${p.title}`));
  }
  if (shadow.demoted.length) {
    console.log('  新内核会降权:');
    shadow.demoted.forEach(p => console.log(`   ↓ ${p.rankScore ?? '—'} 分 | ${p.title}`));
  }
  console.log('\n  新内核 TOP-10:');
  newTop10.forEach((line, index) => console.log(`   ${index + 1}. ${line}`));
  console.log('\n（本报表只读，不改变任何行为。切换默认排序需先看影子数据。）');
}
