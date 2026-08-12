/**
 * demo-briefing-evolution.mjs - G3 端到端演示（离线、内存快照）
 *
 * 链路：Day1 落盘 digest → Day2 落盘 digest → 读前日快照 diff 出跨日演化段
 * 运行：node scripts/demo-briefing-evolution.mjs
 */
import { createMemoryStorage, createSnapshotStore } from '../src/domain/intelligence/snapshotStore.js';
import {
  digestFromBriefing,
  saveDailyDigest,
  buildBriefingEvolution,
} from '../src/domain/intelligence/briefingEvolution.js';

// 模拟 Day1（8-11）的简报（agenticBriefing 形状，用 clusters）
const DAY1_BRIEFING = {
  date: '2026-08-11',
  mode: 'agentic',
  clusters: [
    { clusterId: 'ev-openai-gpt5', primaryTitle: 'OpenAI 发布 GPT-5 多模态模型', sourceCount: 3, itemIds: ['a1', 'a2', 'a3'] },
    { clusterId: 'ev-eu-ai-act', primaryTitle: '欧盟通过 AI 法案补充条款', sourceCount: 2, itemIds: ['b1', 'b2'] },
    { clusterId: 'ev-chip-factory', primaryTitle: '半导体工厂因停电停产', sourceCount: 1, itemIds: ['d1'] },
  ],
};

// 模拟 Day2（8-12）的简报：GPT-5 持续、欧盟条款升级（标题改写但同事件）、新增国产模型、半导体停产已消退
const DAY2_BRIEFING = {
  date: '2026-08-12',
  mode: 'agentic',
  clusters: [
    { clusterId: 'ev-openai-gpt5-2', primaryTitle: 'OpenAI 推出 GPT-5 支持图像与语音', sourceCount: 4, itemIds: ['a1', 'a2', 'a3', 'a4'] },
    { clusterId: 'ev-eu-ai-act-2', primaryTitle: '欧盟 AI 法案新增高风险模型审查要求', sourceCount: 2, itemIds: ['b1', 'b2'] },
    { clusterId: 'ev-domestic-llm', primaryTitle: '国产大模型厂商公布最新开源权重', sourceCount: 1, itemIds: ['c1'] },
  ],
};

const main = () => {
  const store = createSnapshotStore(createMemoryStorage());

  // 落盘两日 digest（真实场景：每日生成简报后调用一次）
  saveDailyDigest(store, digestFromBriefing(DAY1_BRIEFING));
  saveDailyDigest(store, digestFromBriefing(DAY2_BRIEFING));

  console.log('=== 已落盘快照 ===');
  store.list().forEach((s) => console.log(`  ${s.date}：话题 ${s.topics.length} 条`));

  console.log('\n=== G3 跨日演化（8-12 对比 8-11）===');
  const evolution = buildBriefingEvolution({
    store,
    todayDigest: digestFromBriefing(DAY2_BRIEFING),
    todayDate: '2026-08-12',
    lookbackDays: 1,
  });

  console.log(`hasPrevious=${evolution.hasPrevious} prevDate=${evolution.prevDate}`);
  console.log(`持续演进：${evolution.ongoing.map((o) => o.title).join('；') || '（无）'}`);
  console.log(`今日新增：${evolution.added.map((t) => t.title).join('；') || '（无）'}`);
  console.log(`已消退/解决：${evolution.resolved.map((y) => y.title).join('；') || '（无）'}`);
  console.log(`\n[narrative]\n${evolution.narrative}`);

  console.log('\nOK: G3 demo 完成');
};

main();
