/**
 * compare-clustering.mjs - 词法聚类 vs 语义聚类 质量对比（G1 验证脚本）
 *
 * 用法：
 *   node scripts/compare-clustering.mjs
 *
 * 说明：
 * - 词法侧：复用现有 recommendationEngine.clusterEvents（标题 token Jaccard）。
 * - 语义侧：semanticCluster.buildSemanticClusters，embedFn 默认走本地 TF-IDF + 同义词扩展
 *   （离线可跑的 stand-in，仅用于演示"更好的 embedding 能合并词法漏掉的改写对"）。
 * - 接入真实多语言 embedding：设置环境变量后自动改用托管 API（OpenAI 兼容）：
 *     EMBEDDING_BASE_URL=https://your-endpoint/v1
 *     EMBEDDING_API_KEY=sk-xxx
 *     EMBEDDING_MODEL=text-embedding-3-small   # 或多语言模型如 multilingual-e5
 *   真实 embedding（尤其 multilingual-e5）对跨语言/改写/翻译标题的合并率会显著高于本 stand-in。
 */

import { clusterEvents } from '../src/domain/intelligence/recommendationEngine.js';
import { buildSemanticClusters } from '../src/domain/intelligence/semanticCluster.js';

/* ---------------- 样例数据（含"同事件改写对"，用于验证合并率） ---------------- */
const ITEMS = [
  // 事件 A：AI 芯片出口管制（4 篇，措辞各不相同）
  { id: 'a1', title: 'US tightens export controls on AI chips', source: 'Reuters', publishedAt: '2026-08-11T08:00:00Z', mustReadScore: 80 },
  { id: 'a2', title: 'New restrictions on AI semiconductor exports announced', source: 'Bloomberg', publishedAt: '2026-08-11T09:30:00Z', mustReadScore: 75 },
  { id: 'a3', title: 'Washington expands curbs on advanced chip shipments to China', source: 'WSJ', publishedAt: '2026-08-11T10:15:00Z', mustReadScore: 70 },
  { id: 'a4', title: 'Biden administration limits Nvidia AI accelerator sales', source: 'CNBC', publishedAt: '2026-08-11T11:00:00Z', mustReadScore: 68 },
  // 事件 B：Apple 财报（3 篇）
  { id: 'b1', title: 'Apple reports record Q3 services revenue', source: 'Verge', publishedAt: '2026-08-10T20:00:00Z', mustReadScore: 60 },
  { id: 'b2', title: "Apple's quarterly earnings beat estimates on services growth", source: 'CNBC', publishedAt: '2026-08-10T20:30:00Z', mustReadScore: 58 },
  { id: 'b3', title: 'AAPL Q3 results: services hit all-time high', source: 'Bloomberg', publishedAt: '2026-08-10T21:00:00Z', mustReadScore: 55 },
  // 事件 C：气候峰会（2 篇）
  { id: 'c1', title: 'UN climate summit agrees on fossil fuel transition roadmap', source: 'Guardian', publishedAt: '2026-08-09T15:00:00Z', mustReadScore: 50 },
  { id: 'c2', title: 'COP30 reaches deal on phasing down coal', source: 'Reuters', publishedAt: '2026-08-09T16:00:00Z', mustReadScore: 48 },
  // 事件 D：Freepress 融资（2 篇）
  { id: 'd1', title: 'French AI news startup Freepress raises 1M euro seed', source: 'TechCrunch', publishedAt: '2026-08-08T12:00:00Z', mustReadScore: 45 },
  { id: 'd2', title: 'Freepress secures seed funding to expand AI news service', source: 'EU-Startups', publishedAt: '2026-08-08T13:00:00Z', mustReadScore: 44 },
  // 不相关单条
  { id: 'x1', title: 'Local football team wins championship', source: 'TownNews', publishedAt: '2026-08-07T18:00:00Z', mustReadScore: 20 },
  { id: 'x2', title: 'New recipe for sourdough bread goes viral', source: 'FoodBlog', publishedAt: '2026-08-07T19:00:00Z', mustReadScore: 18 },
  { id: 'x3', title: 'Stock market closes higher on jobs data', source: 'Reuters', publishedAt: '2026-08-07T20:00:00Z', mustReadScore: 30 },
  { id: 'x4', title: 'Scientists discover new exoplanet', source: 'Nature', publishedAt: '2026-08-07T21:00:00Z', mustReadScore: 25 },
];

// 期望应被合并进同一事件的"对"（用于算合并率）
const EXPECTED_PAIRS = [
  ['a1', 'a2'], ['a1', 'a3'], ['a1', 'a4'], ['a2', 'a3'], ['a2', 'a4'], ['a3', 'a4'],
  ['b1', 'b2'], ['b1', 'b3'], ['b2', 'b3'],
  ['c1', 'c2'],
  ['d1', 'd2'],
];

/* ---------------- 本地 TF-IDF + 同义词扩展 stand-in（离线可跑） ---------------- */
const SYN = {
  ai: 'artificialintelligence', 'a.i.': 'artificialintelligence',
  chip: 'semiconductor', chips: 'semiconductor', semiconductor: 'semiconductor',
  export: 'exportcontrol', exports: 'exportcontrol', exportcontrols: 'exportcontrol',
  controls: 'exportcontrol', restrictions: 'exportcontrol', curbs: 'exportcontrol',
  limit: 'exportcontrol', limits: 'exportcontrol',
  shipment: 'shipment', shipments: 'shipment',
  nvidia: 'nvidia', washington: 'usgov', biden: 'usgov', us: 'usgov', 'unitedstates': 'usgov',
  quarterly: 'earnings', quarter: 'earnings', earnings: 'earnings', q3: 'earnings', results: 'earnings',
  services: 'services', revenue: 'revenue',
  climate: 'climate', summit: 'climate', cop30: 'climate', fossil: 'climate', coal: 'climate',
  funding: 'funding', seed: 'funding', raises: 'funding', startup: 'startup', freepress: 'freepress',
};

function tokenize(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 1)
    .map((w) => SYN[w] || w);
}

function buildLocalEmbeddings(texts) {
  const tokDocs = texts.map(tokenize);
  const df = new Map();
  tokDocs.forEach((toks) => {
    const uniq = new Set(toks);
    uniq.forEach((w) => df.set(w, (df.get(w) || 0) + 1));
  });
  const vocab = [...df.keys()].sort();
  const vidx = new Map(vocab.map((w, i) => [w, i]));
  const N = texts.length;
  return tokDocs.map((toks) => {
    const tf = new Map();
    toks.forEach((w) => tf.set(w, (tf.get(w) || 0) + 1));
    const vec = new Array(vocab.length).fill(0);
    for (const [w, c] of tf) {
      const idf = Math.log((N + 1) / (df.get(w) + 1)) + 1;
      vec[vidx.get(w)] = c * idf;
    }
    return vec;
  });
}

/* 托管 embedding 适配器（OpenAI 兼容）。未配置环境变量时返回 null，回落本地。 */
async function hostedEmbed(texts) {
  const base = process.env.EMBEDDING_BASE_URL;
  const key = process.env.EMBEDDING_API_KEY;
  const model = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
  if (!base || !key) return null;
  const res = await fetch(`${base.replace(/\/$/, '')}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, input: texts }),
  });
  if (!res.ok) throw new Error(`embedding API ${res.status}`);
  const data = await res.json();
  return data.data.map((d) => d.embedding);
}

/* ---------------- 评估 ---------------- */
function pairsMergedRate(clusters, pairs) {
  const idToCluster = new Map();
  clusters.forEach((c, ci) => c.itemIds.forEach((id) => idToCluster.set(id, ci)));
  let merged = 0;
  pairs.forEach(([i, j]) => {
    if (idToCluster.get(i) !== undefined && idToCluster.get(i) === idToCluster.get(j)) merged += 1;
  });
  return { merged, total: pairs.length, rate: merged / pairs.length };
}

function printClusters(title, clusters) {
  console.log(`\n### ${title}（${clusters.length} 个簇）`);
  clusters.forEach((c, i) => {
    const src = [...new Set(c.items.map((it) => it.source))].join('/');
    console.log(`  簇#${i} [${c.itemIds.length}篇 / ${src}]:`);
    c.items.forEach((it) => console.log(`     - ${it.id}: ${it.title}`));
  });
}

/* ---------------- 主流程 ---------------- */
async function main() {
  const hosted = await hostedEmbed(ITEMS.map((it) => it.title)).catch(() => null);
  const usingHosted = Array.isArray(hosted) && hosted.length === ITEMS.length;

  console.log('============================================================');
  console.log(' 词法聚类 (Jaccard)  vs  语义聚类 (embeddings)');
  console.log('============================================================');
  console.log(`样本: ${ITEMS.length} 条 | 期望同事件对: ${EXPECTED_PAIRS.length} 对`);
  console.log(`Embedding 来源: ${usingHosted ? `托管 API (${process.env.EMBEDDING_MODEL})` : '本地 TF-IDF+同义词 stand-in（离线）'}`);

  // 词法
  const lexical = clusterEvents(ITEMS, { similarityThreshold: 0.72 });
  printClusters('词法聚类 clusterEvents', lexical);
  const lexRate = pairsMergedRate(lexical, EXPECTED_PAIRS);

  // 语义
  const embedFn = usingHosted
    ? async (texts) => hosted
    : async (texts) => buildLocalEmbeddings(texts);
  const semantic = await buildSemanticClusters(ITEMS, embedFn, { threshold: usingHosted ? 0.3 : 0.35 });
  printClusters('语义聚类 buildSemanticClusters', semantic);
  const semRate = pairsMergedRate(semantic, EXPECTED_PAIRS);

  console.log('\n============================================================');
  console.log(' 同事件对合并率（越高越好）');
  console.log('============================================================');
  console.log(`  词法 Jaccard : ${lexRate.merged}/${lexRate.total}  (${(lexRate.rate * 100).toFixed(0)}%)`);
  console.log(`  语义 embeddings: ${semRate.merged}/${semRate.total}  (${(semRate.rate * 100).toFixed(0)}%)`);
  const delta = (semRate.rate - lexRate.rate) * 100;
  console.log(`  提升: ${delta >= 0 ? '+' : ''}${delta.toFixed(0)} 个百分点 ${delta > 0 ? '✅' : ''}`);
  console.log('\n注: 本地 stand-in 仅为 TF-IDF + 同义词表（离线可跑）。接入真实多语言');
  console.log('    embedding API（如 multilingual-e5）后，跨语言/翻译/改写标题的合并率会更高。');
}

main().catch((err) => {
  console.error('对比脚本出错:', err);
  process.exit(1);
});
