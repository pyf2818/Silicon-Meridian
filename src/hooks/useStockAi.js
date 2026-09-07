/**
 * useStockAi — 股市智能模块（联动 LLM）
 * 提供：AI 个股诊断 / AI 市场早报 / 自选股智能监控
 * 全部调用 /api/ai-generate，无 LLM 配置时返回引导提示。
 * 合规：仅基于数据做技术面/资金面客观解读，不给买卖建议，标注「仅供参考」。
 *
 * 架构：模块级 store，hook 只是订阅。组件 unmount 后正在跑的 AI 任务继续，
 *      回到页面时从 store 恢复最新状态。llmConfig 由 hook 同步进 store 供 actions 使用。
 */
import { useState, useEffect, useCallback } from 'react';
import { analyzeStock } from '../domain/stock/algorithmAnalysis.js';
import { buildStockEvidencePacket, formatEvidencePacketForPrompt } from '../domain/stock/evidencePacket.js';

const COMPLIANCE_SUFFIX = '\n\n（以上内容由 AI 基于公开行情数据生成，仅供参考，不构成投资建议）';
const BRIEFING_HISTORY_KEY = 'stockBriefingHistoryV1';
const BRIEFING_HISTORY_LIMIT = 30;

function loadBriefingHistory() {
  try {
    const records = JSON.parse(localStorage.getItem(BRIEFING_HISTORY_KEY) || '[]');
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}

function persistBriefingHistory(records) {
  try { localStorage.setItem(BRIEFING_HISTORY_KEY, JSON.stringify(records)); } catch { /* storage unavailable */ }
}

// 检查 LLM 是否可用
function useLlmReady(llmConfig) {
  return Boolean(llmConfig?.baseUrl && llmConfig?.apiKey && llmConfig?.selectedModel);
}

// 统一调用 /api/ai-generate
async function callLlm(llmConfig, systemPrompt, userPrompt) {
  const res = await fetch('/api/ai-generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      baseUrl: llmConfig.baseUrl,
      apiKey: llmConfig.apiKey,
      model: llmConfig.selectedModel,
      action: 'chat',
      messages: [{ role: 'user', content: userPrompt }],
      systemPrompt,
    }),
  });
  const data = await res.json();
  if (!data.content) throw new Error(data.message || 'AI 返回为空');
  return data.content;
}

// ===== 模块级 store：组件 unmount 后任务继续，store 保持状态 =====
const store = {
  state: {
    llmConfig: null,
    diagnosing: false, diagnosis: null, diagnoseError: '',
    briefingLoading: false, briefing: null, briefingError: '',
    briefingHistory: loadBriefingHistory(),
    alertChecking: false, alertResults: [],
  },
  subscribers: new Set(),
  subscribe(fn) { this.subscribers.add(fn); return () => this.subscribers.delete(fn); },
  notify() { this.subscribers.forEach(fn => fn(this.state)); },
  setState(patch) { this.state = { ...this.state, ...patch }; this.notify(); },
};

export async function runStockAnalysis({ input, llmConfig, experienceMode = 'beginner', investorPolicy = null, callLlm: invokeLlm = callLlm }) {
  const algorithm = analyzeStock(input);
  const evidencePacket = buildStockEvidencePacket({ ...input, diagnosis: algorithm });
  const algorithmResult = {
    ...algorithm,
    evidencePacket,
    content: `${algorithm.summary}\n\n${algorithm.disclaimer}`,
  };
  const llmAvailable = Boolean(llmConfig?.baseUrl && llmConfig?.apiKey && llmConfig?.selectedModel);
  if (!llmAvailable || algorithm.status !== 'ready') return algorithmResult;

  const metrics = algorithm.metrics;
  const modeGuidance = experienceMode === 'pro'
    ? '面向专业用户：按「关键位 → 驱动逻辑 → 证据权重 → 失效条件 → 数据边界」输出，可用 Markdown 表格汇总指标；定量表述（百分比、价位区间），区分已确认事实与推断，给出可操作的复核清单，不堆砌指标。'
    : '面向新手用户：循序渐进地讲解，按以下结构输出——【一句话结论】用大白话说当前处境；【为什么会这样】解释背后逻辑，把每个术语（如均线、波动率、支撑/压力）都用生活化比喻讲清；【接下来怎么观察】给出 2-3 个具体可执行的观察动作；【新手学习点】今天能从这只股票学到的一个知识点。语气友好鼓励，引导成长，不制造焦虑，不使用交易黑话。';
  const policyGuidance = investorPolicy ? `\u7528\u6237\u7b56\u7565\uff1a${investorPolicy.horizon || '\u672a\u8bbe\u7f6e'}\u5468\u671f\u3001${investorPolicy.riskTolerance || '\u672a\u8bbe\u7f6e'}\u98ce\u9669\u504f\u597d\u3001\u5355\u7b14\u98ce\u9669\u4e0a\u9650 ${investorPolicy.riskPerTrade || '--'}%\u3002` : '';
  const systemPrompt = `\u4f60\u662f\u4e13\u4e1a\u4e14\u5ba1\u614e\u7684\u80a1\u5e02\u5206\u6790\u5e08\u3002\u53ea\u80fd\u57fa\u4e8e\u7ed9\u5b9a\u7684\u786e\u5b9a\u6027\u6307\u6807\u589e\u5f3a\u8868\u8ff0\uff0c\u4e0d\u5f97\u6539\u53d8\u7b97\u6cd5\u8bc4\u7ea7\u6216\u865a\u6784\u6570\u636e\u3002\u5fc5\u987b\u533a\u5206\u201c\u5df2\u786e\u8ba4\u201d\u3001\u201c\u5f85\u9a8c\u8bc1\u201d\u548c\u201c\u4e0d\u80fd\u5224\u65ad\u201d\uff1b\u8bc1\u636e\u8986\u76d6\u6709\u9650\u65f6\u4e0d\u5f97\u5347\u7ea7\u4e3a\u786e\u5b9a\u6027\u7ed3\u8bba\u3002\u7981\u6b62\u7ed9\u51fa\u4e70\u5356\u5efa\u8bae\uff0c220\u5b57\u5185\u3002${modeGuidance}${policyGuidance}`;
  const userPrompt = `股票：${algorithm.stock.name}（${algorithm.stock.code}）
算法评级：${algorithm.rating}；风险：${algorithm.risk}
现价：${metrics.price}；MA5/10/20：${metrics.ma5}/${metrics.ma10}/${metrics.ma20}
5日动量：${metrics.momentum5}%；年化波动率：${metrics.volatility}%
支撑/压力：${metrics.support}/${metrics.resistance}；量能：${metrics.volumeTrend}\n\n【研究证据包】\n${formatEvidencePacketForPrompt(evidencePacket)}`;
  try {
    const aiNarrative = await invokeLlm(llmConfig, systemPrompt, userPrompt);
    return {
      ...algorithmResult,
      mode: 'ai',
      aiNarrative,
      algorithm,
      content: `${aiNarrative}${COMPLIANCE_SUFFIX}`,
    };
  } catch (error) {
    return {
      ...algorithmResult,
      aiError: error?.message || 'AI 增强失败，已保留算法分析',
    };
  }
}

export function useStockAi(llmConfig) {
  const llmReady = useLlmReady(llmConfig);

  // 把最新 llmConfig 同步进 store（actions 从 store 读取，避免组件卸载后丢失配置）
  useEffect(() => { store.setState({ llmConfig }); }, [llmConfig]);

  // 订阅 store，组件 unmount 后自动取消订阅
  const [snapshot, setSnapshot] = useState(store.state);
  useEffect(() => store.subscribe(setSnapshot), []);

  // ===== 模块 A：确定性算法分析 + 可选 AI 增强 =====
  const diagnoseStock = useCallback(async ({ stock, kline, benchmarkKline, benchmark, realtime, sectors, experienceMode = 'beginner', investorPolicy = null }) => {
    store.setState({ diagnosing: true, diagnoseError: '' });
    try {
      const result = await runStockAnalysis({
        input: { stock, realtime, klines: kline?.klines || [], benchmarkKlines: benchmarkKline?.klines || [], benchmark, sectors },
        experienceMode,
        investorPolicy,
        llmConfig: store.state.llmConfig,
      });
      store.setState({ diagnosis: { ...result, at: Date.now() }, diagnosing: false });
    } catch (e) {
      store.setState({ diagnoseError: e.message || '行情分析失败', diagnosing: false });
    }
  }, []);

  // ===== 模块 B：AI 市场早报 =====
  const generateMorningBrief = useCallback(async ({ indices, stocks, sectors, coverage, experienceMode = 'beginner', investorPolicy = null }) => {
    const cfg = store.state.llmConfig;
    if (!cfg || !cfg.baseUrl || !cfg.apiKey || !cfg.selectedModel) {
      store.setState({ briefingError: '请先配置大模型' });
      return;
    }
    store.setState({ briefingLoading: true, briefingError: '' });
    try {
      const stockRows = stocks || [];
      const sectorRows = sectors || [];
      const idxText = (indices || []).map(i => `${i.name}：${i.price}，涨跌 ${i.changePct >= 0 ? '+' : ''}${i.changePct}%`).join('\n') || '无数据';
      const stockText = stockRows.slice(0, 20).map(s => `${s.name}(${s.code})：现价 ${s.price}，涨跌 ${s.changePct >= 0 ? '+' : ''}${s.changePct}%，成交额 ${s.amount || '未提供'}`).join('\n') || '无数据';
      const sectorText = sectorRows.slice(0, 12).map(s => `${s.name}：${s.changePct >= 0 ? '+' : ''}${s.changePct}%`).join('\n') || '无数据';
      const up = stockRows.filter(item => item.changePct > 0).length;
      const down = stockRows.filter(item => item.changePct < 0).length;
      const generatedAt = new Date().toISOString();

      const modeGuidance = experienceMode === 'pro'
        ? '面向专业用户：结构化、可复核。执行摘要给量化判断；指数与板块部分标注驱动与风险预算；个股观察附关键位与失效条件；风险清单按概率×影响排序。可用 Markdown 表格。避免套话，每个判断都要能追溯到给定数据。'
        : '面向新手用户：先给 3 句话以内的白话总评（今天市场怎么样、为什么、该注意什么），正文每个小节先用一句白话概括再展开；出现术语时用括号补一句比喻解释；结尾给出「本周观察练习」：一个新手今天就能做的小动作。语气友好鼓励，不制造焦虑，不把涨跌等同于买卖信号。';
      const policyGuidance = investorPolicy ? `\u7528\u6237\u7b56\u7565\uff1a${investorPolicy.horizon || '\u672a\u8bbe\u7f6e'}\u5468\u671f\u3001${investorPolicy.riskTolerance || '\u672a\u8bbe\u7f6e'}\u98ce\u9669\u504f\u597d\u3001\u6700\u5927\u4ed3\u4f4d ${investorPolicy.maxPosition || '--'}%\u3002` : '';
      const systemPrompt = `你是审慎、专业的中国股票市场研究员。只能使用用户提供的行情样本，生成 700-1200 字中文结构化早报。
必须按以下标题输出：
## 一、执行摘要
## 二、指数与样本广度
## 三、板块主线与轮动
## 四、关键个股观察
## 五、多方情景与反方情景
## 六、风险清单
## 七、今日观察清单
## 八、数据边界
规则：明确区分"数据事实"和"分析推断"；解释驱动因素时只能写待验证假设，不能伪造新闻、公告、财务、资金流或宏观数据；同时给出支持证据、反向证据和失效条件；不提供确定性涨跌预测、目标价或买卖指令。内容具体、可复核，避免空泛套话。${modeGuidance}${policyGuidance}`;
      const userPrompt = `生成时间：${generatedAt}
数据口径：${coverage?.label || '行情样本'}，共 ${stockRows.length} 只；上涨 ${up}、下跌 ${down}。这不是全市场涨跌家数。
数据频率：轮询行情，不是交易所逐笔数据。

【主要指数】
${idxText}

【活跃股票样本】
${stockText}

【板块涨幅样本】
${sectorText}

请基于以上有限数据完成早报，并在"数据边界"中明确缺少全市场广度、财务、公告、新闻、资金流、估值与持仓数据。`;

      const content = await callLlm(cfg, systemPrompt, userPrompt);
      const record = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        content: content + COMPLIANCE_SUFFIX,
        at: Date.now(),
        meta: { indexCount: indices?.length || 0, stockCount: stockRows.length, sectorCount: sectorRows.length, coverage: coverage?.label || '行情样本' },
      };
      store.setState({
        briefing: record,
        briefingLoading: false,
        briefingHistory: (() => {
          const next = [record, ...store.state.briefingHistory].slice(0, BRIEFING_HISTORY_LIMIT);
          persistBriefingHistory(next);
          return next;
        })(),
      });
    } catch (e) {
      store.setState({ briefingError: e.message || '早报生成失败', briefingLoading: false });
    }
  }, []);

  // ===== 模块 C：自选股智能监控 =====
  const checkAlerts = useCallback(async (watchlist, conditions) => {
    const cfg = store.state.llmConfig;
    if (!cfg || !cfg.baseUrl || !cfg.apiKey || !cfg.selectedModel) {
      return { needConfig: true };
    }
    if (!watchlist || watchlist.length === 0) return { hits: [] };
    store.setState({ alertChecking: true });
    try {
      const results = await Promise.all(watchlist.map(async (stock) => {
        try {
          const res = await fetch(`/api/stock/realtime?code=${stock.code}`);
          const r = await res.json();
          return { stock, realtime: r };
        } catch { return { stock, realtime: null }; }
      }));

      const hitItems = [];
      for (const { stock, realtime } of results) {
        if (!realtime) continue;
        const hit = evaluateCondition(realtime, conditions[stock.code]);
        if (hit) hitItems.push({ stock, realtime, condition: conditions[stock.code], reason: hit });
      }

      if (hitItems.length === 0) {
        store.setState({ alertResults: [], alertChecking: false });
        return { hits: [] };
      }

      const systemPrompt = '你是股市监控助手。基于命中的监控条件，用中文为每只股票生成一句话提醒。客观陈述触发事实，不给买卖建议。每只 30 字内。';
      const itemsText = hitItems.map((h, i) => `${i + 1}. ${h.stock.name}(${h.stock.code}) 现价${h.realtime.price} 涨跌${h.realtime.changePct}% 触发：${h.reason}`).join('\n');
      const content = await callLlm(cfg, systemPrompt, `以下自选股命中监控条件：\n${itemsText}\n\n请逐只生成提醒。`);

      store.setState({
        alertResults: hitItems.map((h, i) => ({ ...h, aiText: extractLine(content, i) || h.reason })),
        alertChecking: false,
      });
      return { hits: hitItems };
    } catch (e) {
      store.setState({ alertChecking: false });
      return { error: e.message || '监控检查失败' };
    }
  }, []);

  const clearDiagnosis = useCallback(() => store.setState({ diagnosis: null, diagnoseError: '' }), []);
  const clearBriefing = useCallback(() => store.setState({ briefing: null, briefingError: '' }), []);
  const openBriefing = useCallback(record => store.setState({ briefing: record, briefingError: '' }), []);
  const deleteBriefing = useCallback(id => {
    const next = store.state.briefingHistory.filter(record => record.id !== id);
    persistBriefingHistory(next);
    store.setState({
      briefingHistory: next,
      briefing: store.state.briefing?.id === id ? null : store.state.briefing,
    });
  }, []);
  const clearBriefingHistory = useCallback(() => {
    persistBriefingHistory([]);
    store.setState({ briefingHistory: [], briefing: null });
  }, []);

  return {
    llmReady,
    // 诊断
    diagnosing: snapshot.diagnosing,
    diagnosis: snapshot.diagnosis,
    diagnoseError: snapshot.diagnoseError,
    diagnoseStock, clearDiagnosis,
    // 早报
    briefingLoading: snapshot.briefingLoading,
    briefing: snapshot.briefing,
    briefingError: snapshot.briefingError,
    briefingHistory: snapshot.briefingHistory,
    generateMorningBrief, clearBriefing, openBriefing, deleteBriefing, clearBriefingHistory,
    // 监控
    alertChecking: snapshot.alertChecking,
    alertResults: snapshot.alertResults,
    checkAlerts,
  };
}

// 监控条件本地评估 —— 返回命中原因字符串，未命中返回 null
function evaluateCondition(realtime, condition) {
  if (!condition || !realtime) return null;
  const { changePct = 0, price = 0, prevClose = 0 } = realtime;
  switch (condition) {
    case 'up_over_3': return changePct > 3 ? `涨幅 ${changePct.toFixed(2)}% 超过 3%` : null;
    case 'down_over_3': return changePct < -3 ? `跌幅 ${changePct.toFixed(2)}% 超过 3%` : null;
    case 'up_over_5': return changePct > 5 ? `涨幅 ${changePct.toFixed(2)}% 超过 5%` : null;
    case 'down_over_5': return changePct < -5 ? `跌幅 ${changePct.toFixed(2)}% 超过 5%` : null;
    case 'flat': return Math.abs(changePct) < 0.5 ? `横盘整理，涨跌 ${changePct.toFixed(2)}%` : null;
    default: return null;
  }
}

// 从 LLM 多行返回里提取第 i 条
function extractLine(text, index) {
  if (!text) return '';
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  return lines[index] || '';
}

// 监控条件选项（供 UI 渲染）
export const ALERT_CONDITIONS = [
  { id: 'up_over_3', label: '涨幅超 3%' },
  { id: 'down_over_3', label: '跌幅超 3%' },
  { id: 'up_over_5', label: '涨幅超 5%' },
  { id: 'down_over_5', label: '跌幅超 5%' },
  { id: 'flat', label: '横盘整理' },
];
