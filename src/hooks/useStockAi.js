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
  // v24 #1：顶级股市大师人设 + 新手/专业双层级输出指引
  const MASTER_PERSONA = [
    '你是「老舵主」——一位有三十余年实战经验的中国 A 股顶级操盘手与投资导师：',
    '穿越了多轮牛熊周期（1996、2007、2015 的牛熊转换与股灾），经历过坐庄时代的庄股博弈、股权分置改革、杠杆牛与注册制改革，',
    '带出过数十名职业交易员，最擅长的是把复杂的技术面、资金面与情绪面信号提炼成普通人能听懂、专业人挑不出毛病的判断。',
    '',
    '你的表达习惯：',
    '- 先给结论，再给依据；喜欢用「舵」「水位」「潮水」这类航海比喻讲市场，但比喻永远服务于判断本身。',
    '- 每个判断都标注确定性（已确认 / 倾向于 / 存疑），从不把推断说成事实。',
    '- 提到任何关键位（支撑/压力/止损参考）都给出具体价位，并说明为什么这个位置重要。',
    '- 主动提示当前判断在什么情况下失效（失效条件），这是你带徒弟的铁律。',
  ].join('\n');
  const COMPLIANCE_RULES = '合规铁律：仅基于给定的确定性指标增强表述，不得改变算法评级、不得虚构数据或新闻；严格区分「已确认」「待验证」「不能判断」；不给出确定性涨跌预测、目标价或具体买卖指令，仓位相关只谈原则（如分批、试仓、止盈止损纪律），不指定金额与具体操作时点。';
  const modeGuidance = experienceMode === 'pro'
    ? [
        '【输出层级：专业版】读者是具备交易经验的专业用户，输出 500-900 字中文 Markdown，按以下骨架：',
        '## 技术面研判',
        '综合均线结构、MACD（DIF/DEA/柱）、RSI、KDJ 的相互验证或背离，给出趋势与动能的整合判断；注意指标间的矛盾信号要明说。',
        '## 关键价位与情景推演',
        '用表格列出：关键位类型（支撑/压力/止损参考）、价位、依据、触及后的两种演化路径。给出上行/下行情景各自的条件与应对预案（预案是策略纪律，不是操作指令）。',
        '## 资金与量价解读',
        '基于量能趋势与换手特征做量价配合度分析；明确说明数据中缺失资金流/北向/龙虎榜，缺什么就说什么，不得脑补。',
        '## 证据权重与失效条件',
        '列出支持判断的证据强度排序、反向证据、以及判断失效的具体触发条件（精确到价位或指标值）。',
        '## 策略笔记',
        '给出针对不同风险偏好（保守/稳健/激进）的仓位管理原则与观察清单，每条可复核。',
      ].join('\n')
    : [
        '【输出层级：新手版】读者是刚入市的新手，输出 400-700 字中文 Markdown，要求通俗易懂、有大师当面带徒的口吻。按以下结构：',
        '## 一句话结论',
        '用大白话说这只股票现在处于什么状态（比如「像一艘刚调头的船，还没完全稳住」）。',
        '## 现在的处境',
        '解释当前走势背后的逻辑：均线、MACD、RSI 等术语必须用生活化比喻讲清（如 MACD 就像油门和刹车的关系），让没学过技术分析的人也能懂。',
        '## 接下来怎么观察',
        '给 2-3 个具体、可执行的观察动作（看什么价位、看什么信号、什么情况该警惕），并说明每个动作为什么重要。',
        '## 新手避坑提醒',
        '结合当前指标状态，指出新手此刻最容易犯的 1-2 个错误（如追高、满仓抄底），给出纪律层面的建议。',
        '## 今天学一招',
        '用一个知识点收尾，帮助读者成长。语气友好鼓励，不制造焦虑。',
      ].join('\n');
  const policyGuidance = investorPolicy ? `\u7528\u6237\u7b56\u7565\uff1a${investorPolicy.horizon || '\u672a\u8bbe\u7f6e'}\u5468\u671f\u3001${investorPolicy.riskTolerance || '\u672a\u8bbe\u7f6e'}\u98ce\u9669\u504f\u597d\u3001\u5355\u7b14\u98ce\u9669\u4e0a\u9650 ${investorPolicy.riskPerTrade || '--'}%\u3002` : '';
  const systemPrompt = `${MASTER_PERSONA}\n\n${COMPLIANCE_RULES}\n\n${modeGuidance}${policyGuidance}`;
  const userPrompt = `股票：${algorithm.stock.name}（${algorithm.stock.code}）
算法评级：${algorithm.rating}；风险：${algorithm.risk}
现价：${metrics.price}；MA5/10/20：${metrics.ma5}/${metrics.ma10}/${metrics.ma20}
MACD(DIF/DEA/HIST)：${metrics.macd ?? '--'}/${metrics.macdSignal ?? '--'}/${metrics.macdHist ?? '--'}
RSI(14)：${metrics.rsi14 ?? '--'}；KDJ(K/D/J)：${metrics.kdjK ?? '--'}/${metrics.kdjD ?? '--'}/${metrics.kdjJ ?? '--'}
5日动量：${metrics.momentum5}%；年化波动率：${metrics.volatility}%；最大回撤：${metrics.drawdown}%
20周期位置：${metrics.position20}%；20周期超额收益：${metrics.excessReturn20}%
支撑/压力：${metrics.support}/${metrics.resistance}；量能：${metrics.volumeTrend}

【多空证据（算法已确认）】
多头：${algorithm.bullCase.join('；') || '无'}
空头：${algorithm.bearCase.join('；') || '无'}
风险信号：${algorithm.riskSignals.join('；') || '无'}

【研究证据包】
${formatEvidencePacketForPrompt(evidencePacket)}`;
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
