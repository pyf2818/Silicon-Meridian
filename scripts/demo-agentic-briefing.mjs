/**
 * demo-agentic-briefing.mjs - G2 端到端演示（离线、mock LLM）
 *
 * 链路：样例资讯 → 本地 embedding 语义聚类(G1) → 多智能体分析简报(G2)
 * 运行：node scripts/demo-agentic-briefing.mjs
 */
import { buildSemanticClusters } from '../src/domain/intelligence/semanticCluster.js';
import { buildAgenticBriefing } from '../src/domain/intelligence/agenticBriefing.js';

// ---- 样例资讯：3 个事件，各有改写报道 ----
const ITEMS = [
  { id: 'a1', title: 'OpenAI 发布 GPT-5 多模态模型', source: 'TechCrunch', publishedAt: '2026-08-12T08:00:00Z', mustReadScore: 90 },
  { id: 'a2', title: 'OpenAI 推出 GPT-5 支持图像与语音', source: 'The Verge', publishedAt: '2026-08-12T09:10:00Z', mustReadScore: 82 },
  { id: 'a3', title: 'GPT-5 正式上线，OpenAI 称推理能力翻倍', source: 'Ars Technica', publishedAt: '2026-08-12T10:00:00Z', mustReadScore: 75 },

  { id: 'b1', title: '欧盟通过 AI 法案补充条款', source: 'Reuters', publishedAt: '2026-08-12T07:30:00Z', mustReadScore: 70 },
  { id: 'b2', title: '欧盟 AI 法案新增高风险模型审查要求', source: 'Bloomberg', publishedAt: '2026-08-12T11:20:00Z', mustReadScore: 64 },

  { id: 'c1', title: '国产大模型厂商公布最新开源权重', source: '36氪', publishedAt: '2026-08-12T06:00:00Z', mustReadScore: 55 },
  { id: 'd1', title: '某半导体工厂因停电停产', source: 'Nikkei', publishedAt: '2026-08-12T05:00:00Z', mustReadScore: 40 },
];

// ---- 离线本地 embedding：词二元组 + TF 权重（确定性，仅供演示）----
function tokenize(text) {
  return String(text).toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
}
function buildLocalEmbeddings(texts) {
  const docs = texts.map(tokenize);
  const df = new Map();
  docs.forEach((toks) => {
    new Set(toks).forEach((w) => df.set(w, (df.get(w) || 0) + 1));
  });
  const vocab = [...df.keys()];
  const idf = (w) => Math.log((docs.length + 1) / (df.get(w) || 1)) + 1;
  return docs.map((toks) => {
    const vec = new Array(vocab.length).fill(0);
    const tf = new Map();
    toks.forEach((w) => tf.set(w, (tf.get(w) || 0) + 1));
    toks.forEach((w) => { vec[vocab.indexOf(w)] = (tf.get(w) || 0) * idf(w); });
    const norm = Math.hypot(...vec) || 1;
    return vec.map((v) => v / norm);
  });
}

// ---- mock LLM：把视角标签和输入要点回声成分析文本（确定性，便于演示/单测）----
function mockLlmCall({ user }) {
  const labelMatch = user.match(/你是第 (.+?)。/);
  const viewLabel = labelMatch ? labelMatch[1] : '视角';
  const head = user.split('\n')[0].replace(/^【协作任务】/, '').slice(0, 50);
  return `[${viewLabel}] 关于「${head}」：背景明确，驱动因素来自供需与政策两端，建议持续追踪独立来源交叉验证。`;
}

const main = async () => {
  console.log('=== G1 语义聚类 ===');
  const clusters = await buildSemanticClusters(ITEMS, buildLocalEmbeddings, { threshold: 0.18 });
  console.log(`聚出 ${clusters.length} 个事件簇：`);
  clusters.forEach((c) => {
    console.log(`  · 《${c.primaryItem.title}》 ${c.items.length} 篇 / ${c.independentSourceCount} 源`);
  });

  console.log('\n=== G2 多智能体分析简报 ===');
  const briefing = await buildAgenticBriefing({
    clusters,
    llmCall: mockLlmCall,
    opts: { maxClusters: 3 },
  });
  console.log(`分析簇数：${briefing.clusters.length}，模式：${briefing.mode}`);
  briefing.clusters.forEach((c) => {
    console.log(`\n— 事件：《${c.primaryTitle}》`);
    c.views.forEach((v) => console.log(`   [${v.viewLabel}] ${String(v.output).slice(0, 40)}…`));
    console.log(`   [总控合成] ${String(c.synthesis).slice(0, 50)}…`);
  });
  console.log(`\n=== 跨簇总览 ===\n${briefing.total}`);
  console.log('\nOK: G2 demo 完成');
};

main().catch((err) => { console.error(err); process.exit(1); });
