/**
 * useStockAi — 股市智能模块（联动 LLM）
 * 提供：AI 个股诊断 / AI 市场早报 / 自选股智能监控
 * 全部调用 /api/ai-generate，无 LLM 配置时返回引导提示。
 * 合规：输出为「条件化买卖剧本」（条件→动作→价位→失效条件），最终决策权与盈亏责任归用户，标注「仅供参考」。
 *
 * 架构：模块级 store，hook 只是订阅。组件 unmount 后正在跑的 AI 任务继续，
 *      回到页面时从 store 恢复最新状态。llmConfig 由 hook 同步进 store 供 actions 使用。
 */
import { useState, useEffect, useCallback } from 'react';
import { analyzeStock } from '../domain/stock/algorithmAnalysis.js';
import { buildStockEvidencePacket, formatEvidencePacketForPrompt } from '../domain/stock/evidencePacket.js';
import { streamLlm } from '../utils/llmStream.js';

const COMPLIANCE_SUFFIX = '\n\n（以上内容由 AI 基于公开行情数据生成，仅供参考，不构成投资建议）';
const BRIEFING_HISTORY_KEY = 'stockBriefingHistoryV1';
const BRIEFING_HISTORY_LIMIT = 30;
// v29 #4：个股诊断历史（localStorage 持久化——诊断本体在内存 store，切页/刷新会丢，历史兜底）
const DIAG_HISTORY_KEY = 'stockDiagnosisHistoryV1';
const DIAG_HISTORY_LIMIT = 30;

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

function loadDiagnosisHistory() {
  try {
    const records = JSON.parse(localStorage.getItem(DIAG_HISTORY_KEY) || '[]');
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}

function persistDiagnosisHistory(records) {
  try { localStorage.setItem(DIAG_HISTORY_KEY, JSON.stringify(records)); } catch { /* storage unavailable */ }
}

/**
 * 从一次诊断结果中抽取可持久化的历史记录（v36.3：附带图表快照数据）。
 * 此前只存 content/rating/price —— 历史预览时指标网格与 ProCharts 全部无法重现
 * （用户反馈「历史记录打开预览图表不显示」的根因）。现在附带：
 *  - status/metrics/多空证据/失效条件/风险信号/dataQuality：指标网格与论据网格所需
 *  - klinesSnapshot：最近 60 根 K 线瘦身序列（{date, close, volume}），ProCharts 走势图所需
 * 体积预算：60 根 × ~50B ≈ 3KB/条 × 30 条上限 ≈ 90KB，localStorage 可承受；
 * persist 侧已有 try/catch 兜底配额异常。
 */
export function buildDiagnosisRecord(result, klines = []) {
  const slimBars = (Array.isArray(klines) ? klines : [])
    .filter(k => Number.isFinite(Number(k?.close)))
    .slice(-60)
    .map(k => ({
      date: k.date || '',
      close: Math.round(Number(k.close) * 1000) / 1000,
      volume: Number.isFinite(Number(k.volume)) ? Math.round(Number(k.volume)) : 0,
    }));
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    code: result.stock?.code || '',
    name: result.stock?.name || '',
    mode: result.mode || 'algorithm',
    status: result.status || 'ready',
    rating: result.rating || '--',
    risk: result.risk || '',
    price: result.metrics?.price ?? null,
    tokens: result.usage?.total_tokens ?? null, // v31：token 用量随记录留存
    content: result.content || result.summary || '',
    // v36.3：图表重现所需快照
    metrics: result.metrics || null,
    bullCase: Array.isArray(result.bullCase) ? result.bullCase : [],
    bearCase: Array.isArray(result.bearCase) ? result.bearCase : [],
    invalidation: Array.isArray(result.invalidation) ? result.invalidation : [],
    riskSignals: Array.isArray(result.riskSignals) ? result.riskSignals : [],
    dataQuality: result.dataQuality || null,
    klinesSnapshot: slimBars,
    at: Date.now(),
  };
}

// 检查 LLM 是否可用
function useLlmReady(llmConfig) {
  return Boolean(llmConfig?.baseUrl && llmConfig?.apiKey && llmConfig?.selectedModel);
}

/**
 * v36.3：为 AI 早报构建个股数据快照（真实指标 + 30 日收盘/成交量序列）。
 * - 覆盖池 = 自选股（前 watchLimit 只，全部进快照）∪ 热门股（按 |涨跌幅| 排序前 hotLimit 只），按 code 去重，总量 totalLimit 封顶
 * - 每只拉 60 根日K 跑 analyzeStock（确定性算法）拿 MA/RSI/动量/支撑压力/量能，与行情快照合成
 * - fetchKline 可注入（单测）；线上默认 fetch /api/stock/kline 日K
 * - 单只失败静默跳过（行情源偶发异常不阻塞整份早报）
 */
export async function buildBriefingSnapshots({
  stocks = [], watchlist = [], fetchKline = null,
  hotLimit = 8, watchLimit = 5, totalLimit = 12,
} = {}) {
  const fetchFn = fetchKline || (async code => {
    try {
      const res = await fetch(`/api/stock/kline?code=${code}&period=101&count=60&adjust=1`);
      const data = await res.json();
      return Array.isArray(data?.klines) ? data.klines : [];
    } catch { return []; }
  });
  const watch = (watchlist || []).filter(s => s?.code).slice(0, watchLimit);
  const hot = [...(stocks || [])]
    .filter(s => s?.code && !watch.some(w => w.code === s.code))
    .sort((a, b) => Math.abs(Number(b?.changePct) || 0) - Math.abs(Number(a?.changePct) || 0))
    .slice(0, hotLimit);
  const picked = [...watch, ...hot].slice(0, totalLimit);
  if (!picked.length) return [];
  const results = await Promise.all(picked.map(async (s) => {
    try {
      const klines = await fetchFn(s.code);
      const bars = (Array.isArray(klines) ? klines : []).filter(k => Number.isFinite(Number(k?.close)));
      if (bars.length < 5) return null;
      const analysis = analyzeStock({
        stock: { name: s.name, code: s.code },
        realtime: { name: s.name, code: s.code, price: s.price, changePct: s.changePct },
        klines: bars,
      });
      if (analysis?.status !== 'ready') return null;
      const m = analysis.metrics;
      return {
        code: s.code,
        name: s.name || '',
        fromWatchlist: watch.some(w => w.code === s.code),
        price: Number(s.price) || m.price,
        changePct: Number(s.changePct) || 0,
        amount: s.amount || '',
        closes: bars.slice(-30).map(k => Math.round(Number(k.close) * 100) / 100),
        volumes: bars.slice(-30).map(k => Math.max(0, Math.round(Number(k.volume) || 0))),
        rating: analysis.rating,
        risk: analysis.risk,
        ma5: m.ma5, ma10: m.ma10, ma20: m.ma20,
        rsi14: m.rsi14, momentum5: m.momentum5,
        support: m.support, resistance: m.resistance,
        volumeTrend: m.volumeTrend, volatility: m.volatility,
      };
    } catch { return null; }
  }));
  return results.filter(Boolean);
}

// 统一调用 /api/ai-generate（v30：流式——onDelta 逐字回调；v31：onUsage 捕获 token 用量）
async function callLlm(llmConfig, systemPrompt, userPrompt, onDelta = null, onUsage = null) {
  const { content, usage } = await streamLlm({
    llmConfig,
    systemPrompt,
    userPrompt,
    onDelta: onDelta || undefined,
    includeUsage: true,
  });
  if (usage && onUsage) onUsage(usage);
  if (!content) throw new Error('AI 返回为空');
  return content;
}

// ===== 模块级 store：组件 unmount 后任务继续，store 保持状态 =====
const store = {
  state: {
    llmConfig: null,
    diagnosing: false, diagnosis: null, diagnoseError: '',
    diagnosisStreamText: '', // v30：诊断 AI 叙述流式槽（生成中逐字更新，完成即清）
    briefingLoading: false, briefing: null, briefingError: '',
    briefingStreamText: '', // v30：早报流式槽
    briefingHistory: loadBriefingHistory(),
    diagnosisHistory: loadDiagnosisHistory(),
    alertChecking: false, alertResults: [],
  },
  subscribers: new Set(),
  subscribe(fn) { this.subscribers.add(fn); return () => this.subscribers.delete(fn); },
  notify() { this.subscribers.forEach(fn => fn(this.state)); },
  setState(patch) { this.state = { ...this.state, ...patch }; this.notify(); },
};

export async function runStockAnalysis({ input, llmConfig, experienceMode = 'beginner', investorPolicy = null, callLlm: invokeLlm = callLlm, onDelta = null }) {
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
  // v29 #2：实战决策派大师人设——融合三大公开方法论（利弗莫尔关键点 / 欧奈尔 CAN SLIM / 米勒维尼 SEPA），
  // 输出从「专业解读」改为「操作剧本」：直接给买卖判断 + 触发条件 + 具体价位 + 失效条件。
  const MASTER_PERSONA = [
    '你是「老舵主」——一位有三十余年实战经验的中国 A 股顶级操盘手与投资导师，带出过数十名职业交易员。',
    '你的决策框架直接继承三位世界级交易大师的公开方法论，并针对 A 股做了本地化：',
    '',
    '【利弗莫尔 · 关键点交易】（出自《股票作手回忆录》公开原则）',
    '- 只在「关键点」行动：股价突破前期高点/密集成交区上沿才考虑买入，跌破关键支撑立即离场；',
    '- 买入后回落跌破关键点 = 判断已错，减仓或退出，绝不摊平亏损，绝不对亏损仓位加仓；',
    '- 没有关键点突破就不动手——空仓等待也是仓位。',
    '',
    '【欧奈尔 · CAN SLIM 纪律】（出自《笑傲股市》公开法则）',
    '- 买点：杯柄/平台等蓄势形态放量突破枢轴点（pivot），不抄底、不提前埋伏；',
    '- 止损铁律：买入后收盘跌破买点 7-8%，无条件卖出、没有例外；止损从建议买点起算，不是随便找的成本价；',
    '- 止盈：常规目标 +20%~25% 分批兑现；若突破后 3 周内涨幅超 20%，按强势股规则持有至少 8 周；',
    '- 大盘过滤：市场确认上升趋势才做突破买入；弱势市场空仓观望，不跟趋势作对；',
    '- A 股本地化：财报披露滞后，留意产业趋势与政策催化领先于报表；风格轮动快，「市场方向」权重更高。',
    '',
    '【米勒维尼 · SEPA 阶段分析】（出自《像冠军一样思考和交易》公开方法）',
    '- 只做第二阶段（上升趋势）的股票：规避底部吸筹阶段与第四阶段下跌趋势，95% 的主升浪发生在第二阶段；',
    '- 关注 VCP（波动收缩）：回调幅度一轮比一轮窄、量能持续萎缩说明浮筹枯竭，突破中枢点即买点；',
    '- 单笔风险不超过账户 1.25%~2.5%：仓位 = 可承受最大亏损 ÷（买价-止损价），先定止损再定仓位；',
    '- 卖出讲究「强势卖出」：上涨中买家活跃时主动离场，优于跌势确认后被动割肉；放量收跌多为机构出货警示；',
    '- 上涨途中第 5~6 个盘整基底后，继续追高的犯错概率急剧上升，视为离场信号。',
    '',
    '你的表达纪律：',
    '- 直接了断：第一句话就是操作判断本身，禁止两边说的骑墙式收尾；说「观望/等待」时必须给出等待到什么价位或什么信号为止；',
    '- 每个动作都来自上述框架的具体规则 + 给定数据：规则条件不触发就明说「条件未触发，不买/不卖」，不硬编理由；',
    '- 提到关键位必须给具体数字（现价、买点触发价、止损价、止盈参考），并说明这个数字怎么算出来的；',
    '- 每个判断标注确定性（已确认 / 倾向于 / 存疑），并主动给出失效条件——判断错了怎么识别、怎么离场。',
  ].join('\n');
  const COMPLIANCE_RULES = '合规铁律：预测价位与时间窗口必须写明推演依据（来自给定数据，不得虚构）；每个判断标注确定性；本分析是交易框架推演而非收益承诺，最终决策权与盈亏责任归用户。';
  const PRICE_TABLE_RULE = [
    '【买卖点与时间预测 · 硬性要求】无论结论是买入还是等待，都必须给出「买卖点 × 时间」预测表（Markdown 表格，列固定）：',
    '| 动作 | 参考价 | 预计时间窗口 | 推演依据 |',
    '| 买入触发 | 具体数字 | 预计 N 天 ~ N 周内（基于当前动能/量能/形态成熟度推演） | 如：突破压力位 X 元且放量 / 回踩 MA20 企稳 |',
    '| 止损 | 具体数字 | 买入后立即生效（收盘跌破即走，不等时间） | 如：买入价 × 0.92 或跌破关键支撑 X 元 |',
    '| 止盈第一档 | 具体数字 | 预计触发后 N 天 ~ N 周 | 如：第一压力位 / +20% 分批 |',
    '| 止盈第二档 | 具体数字 | 视突破后动能，通常更晚 | 如：下一压力位 / +25% |',
    '要求：① 价格推演只用给定数据（支撑/压力/MA/ATR），写明算法；② 时间窗口按「当前 5 日动量与波动速度，多久能走到该价位」推演，注明这是推演不是承诺；③ 三价自洽（止损距买入 -7%~-8%，目标空间 ≥ 2 倍止损空间）；④ 当前若不是买点，同样给出触发后的完整预案表——预测是本职，不许只说「观望」而不给数。',
  ].join('\n');
  const modeGuidance = experienceMode === 'pro'
    ? [
        '【输出层级：专业版】读者是具备交易经验的专业用户，输出 500-900 字中文 Markdown，操作剧本骨架（顺序固定）：',
        '## 结论（先看这里）',
        '用 2-4 句话直接说清三件事：① 当前股票处于什么状态（趋势阶段 / 动能方向 / 所处关键位置）；② 现在值不值得买入或卖出（明确说，结合三大师规则判断）；③ 置信度（高/中/低）+ 一句核心逻辑。禁止骑墙、禁止铺垫。',
        '## 买卖点与时间预测',
        PRICE_TABLE_RULE,
        '## 买点剧本',
        '表格：触发条件（精确价位或指标值）｜动作｜仓位原则。若当前无触发条件，第一行写「当前不是买点」，再给出等待的具体条件（突破什么价位、量能到什么水平、什么形态确认）。',
        '## 卖点剧本',
        '表格：止损纪律（按欧奈尔铁律从建议买点 -7%~8%）｜止盈路径（第一档/第二档分批，或按失效条件移动）｜离场信号（跌破关键点 / 放量滞涨 / 第 5~6 个基底等）。',
        '## 数据依据',
        '每条剧本对应给定数据：均线结构、MACD、RSI、KDJ、支撑压力、量能趋势——引用具体数值，并说明它命中哪位大师规则的哪个条件。',
        '## 失效条件',
        '判断作废的精确触发（价位或指标值），以及触发后第一时间该做的动作。',
      ].join('\n')
    : [
        '【输出层级：新手版】读者是刚入市的新手，输出 400-700 字中文 Markdown，大白话直接给可执行判断，按以下结构：',
        '## 结论（先看这里）',
        '大白话 2-3 句直接说清：现在这只股票是什么状态、该买 / 该等 / 该卖、有几成把握。例如「它正在往上冲但还没站稳，现在别追，等它站上 X 元再动手，大概七成把握」。禁止「建议谨慎观望」这种没有下文的话。',
        '## 买卖参考价和时间',
        PRICE_TABLE_RULE,
        '## 什么时候买',
        '给出具体触发价和信号（站上什么价位、突破什么形态），最多 3 条，每条一句话讲清为什么这是好时机。',
        '## 什么时候卖',
        '止损价：跌到多少必须走、不要犹豫（给具体数字，从买点算跌幅）；止盈参考：涨到哪可以先落袋一部分；出现什么信号要警惕（如放量滞涨、跌破关键价位）。',
        '## 新手最容易踩的坑',
        '结合当前数据指出 1-2 个此刻最容易犯的错（如没等突破就追高、跌破止损还幻想回本），一句话讲清怎么避开。',
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
    let usage = null;
    const aiNarrative = await invokeLlm(llmConfig, systemPrompt, userPrompt, onDelta, u => { usage = u; });
    // v31：数据水印——标注行情时点（优先用行情源时间戳），AI 分析与行情快照强绑定、可追溯
    const quoteTs = Number(input?.realtime?.timestamp);
    const quoteLabel = Number.isFinite(quoteTs) && quoteTs > 0
      ? new Date(quoteTs).toLocaleString('zh-CN')
      : new Date().toLocaleString('zh-CN');
    return {
      ...algorithmResult,
      mode: 'ai',
      aiNarrative,
      usage, // v31：token 用量（测试 mock invokeLlm 时不带，UI 自动隐藏）
      algorithm,
      content: `${aiNarrative}\n\n（行情截至 ${quoteLabel}；以上内容由 AI 基于公开行情数据生成，仅供参考，不构成投资建议）`,
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

  // ===== 模块 A：确定性算法分析 + 可选 AI 增强（v30：AI 叙述流式渲染） =====
  const diagnoseStock = useCallback(async ({ stock, kline, benchmarkKline, benchmark, realtime, sectors, experienceMode = 'beginner', investorPolicy = null }) => {
    store.setState({ diagnosing: true, diagnoseError: '', diagnosisStreamText: '' });
    try {
      const result = await runStockAnalysis({
        input: { stock, realtime, klines: kline?.klines || [], benchmarkKlines: benchmarkKline?.klines || [], benchmark, sectors },
        experienceMode,
        investorPolicy,
        llmConfig: store.state.llmConfig,
        onDelta: (_delta, full) => store.setState({ diagnosisStreamText: full }),
      });
      const record = buildDiagnosisRecord(result, kline?.klines || []);
      const nextHistory = [record, ...store.state.diagnosisHistory].slice(0, DIAG_HISTORY_LIMIT);
      persistDiagnosisHistory(nextHistory);
      store.setState({ diagnosis: { ...result, at: Date.now() }, diagnosing: false, diagnosisStreamText: '', diagnosisHistory: nextHistory });
    } catch (e) {
      store.setState({ diagnoseError: e.message || '行情分析失败', diagnosing: false, diagnosisStreamText: '' });
    }
  }, []);

  // ===== 模块 B：AI 市场早报（v36.3：深度分析版——热点汇总 + 重点个股条件化买卖建议 + 数据图卡） =====
  const generateMorningBrief = useCallback(async ({ indices, stocks, sectors, coverage, watchlist = [], experienceMode = 'beginner', investorPolicy = null }) => {
    const cfg = store.state.llmConfig;
    if (!cfg || !cfg.baseUrl || !cfg.apiKey || !cfg.selectedModel) {
      store.setState({ briefingError: '请先配置大模型' });
      return;
    }
    store.setState({ briefingLoading: true, briefingError: '', briefingStreamText: '' });
    try {
      const stockRows = stocks || [];
      const sectorRows = sectors || [];
      const idxText = (indices || []).map(i => `${i.name}：${i.price}，涨跌 ${i.changePct >= 0 ? '+' : ''}${i.changePct}%`).join('\n') || '无数据';
      const sectorText = sectorRows.slice(0, 12).map(s => `${s.name}：${s.changePct >= 0 ? '+' : ''}${s.changePct}%`).join('\n') || '无数据';
      const up = stockRows.filter(item => item.changePct > 0).length;
      const down = stockRows.filter(item => item.changePct < 0).length;
      const generatedAt = new Date().toISOString();

      // v36.3：个股快照（自选股优先 + 热门股），逐只拉日K 跑确定性算法拿真实指标
      const snapshots = await buildBriefingSnapshots({ stocks: stockRows, watchlist }).catch(() => []);
      const snapshotText = snapshots.map(s => {
        const tag = s.fromWatchlist ? '[自选]' : '';
        const vol = ({ expanding: '放大', contracting: '收缩', stable: '平稳' })[s.volumeTrend] || '--';
        return `- ${s.name}(${s.code})${tag}：现价 ${s.price}，涨跌 ${s.changePct >= 0 ? '+' : ''}${s.changePct}%，成交额 ${s.amount || '未提供'}；MA5/10/20：${s.ma5 ?? '--'}/${s.ma10 ?? '--'}/${s.ma20 ?? '--'}；RSI(14)：${s.rsi14 ?? '--'}；5日动量：${s.momentum5 ?? '--'}%；支撑/压力：${s.support ?? '--'}/${s.resistance ?? '--'}；量能：${vol}；算法评级：${s.rating} / 风险：${s.risk}`;
      }).join('\n') || '无快照数据';

      const modeGuidance = experienceMode === 'pro'
        ? '面向专业用户：结构化、可复核，判断附确定性与失效条件；个股建议给出精确触发价位与推演方式；可用 Markdown 表格。避免套话。'
        : '面向新手用户：先给 3 句话以内的白话总评（今天市场怎么样、为什么、该注意什么）；个股建议用大白话说「现在能不能买/该不该卖」，每个建议带一句「为什么」和「什么情况下这个判断作废」；出现术语用括号补一句比喻解释。语气友好鼓励，不制造焦虑。';
      const policyGuidance = investorPolicy ? `\u7528\u6237\u7b56\u7565\uff1a${investorPolicy.horizon || '\u672a\u8bbe\u7f6e'}\u5468\u671f\u3001${investorPolicy.riskTolerance || '\u672a\u8bbe\u7f6e'}\u98ce\u9669\u504f\u597d\u3001\u6700\u5927\u4ed3\u4f4d ${investorPolicy.maxPosition || '--'}%\u3002` : '';
      const systemPrompt = `你是审慎、专业的中国股票市场研究员与交易顾问。只能使用用户提供的行情样本与个股快照数据，生成 900-1400 字中文结构化早报。
必须按以下标题输出：
## 一、执行摘要
## 二、指数与市场广度
## 三、近期热点汇总与分析
## 四、重点个股操作建议
## 五、多方情景与反方情景
## 六、风险清单
## 七、今日观察清单
## 八、数据边界

各节硬性要求：
- 「近期热点汇总与分析」：从板块涨幅样本与活跃个股分布归纳 2-4 条当日主线（哪些板块领涨/领跌、市场在交易什么逻辑），每条主线注明支撑数据（板块名+涨跌幅、代表个股及涨跌幅），并各给一条反向证据（主线可能失效的信号）。
- 「重点个股操作建议」：对快照清单里的每只股票（标注[自选]的必须全部覆盖）逐只给出「买入 / 卖出 / 持有 / 观望」四选一的倾向性建议。每只一小节，用「### 名称（代码）｜建议：X」开头，正文三行：
  · 判断与确定性：一句话结论，标注（已确认 / 倾向于 / 存疑）；
  · 数据依据：只引用该股快照中的具体数值（现价、涨跌幅、MA5/10/20、RSI、5日动量、支撑/压力、量能），说明命中什么条件（如站上 MA20、RSI 超买、缩量回踩支撑）；
  · 触发价位与失效条件：参考买点/卖点/止损/止盈的具体数字（由支撑、压力与 MA 推演，写明推演方式），以及判断作废的精确触发。
- 规则：明确区分"数据事实"和"分析推断"；所有数字只能来自给定数据，不得虚构新闻、公告、财务、资金流或宏观数据；本早报是条件化交易框架推演而非收益承诺，最终决策权与盈亏责任归用户。${modeGuidance}${policyGuidance}`;
      const userPrompt = `生成时间：${generatedAt}
数据口径：${coverage?.label || '行情样本'}，共 ${stockRows.length} 只；上涨 ${up}、下跌 ${down}。这不是全市场涨跌家数。
数据频率：轮询行情，不是交易所逐笔数据。

【主要指数】
${idxText}

【板块涨幅样本】
${sectorText}

【重点个股快照】（共 ${snapshots.length} 只：自选股优先 + 涨跌幅居前热门股；买卖建议只针对这些股票，30 日收盘/成交量序列已随数据图卡展示给用户）
${snapshotText}

请基于以上有限数据完成早报，并在"数据边界"中明确缺少全市场广度、财务、公告、新闻、资金流、估值与持仓数据，个股建议仅为基于价量数据的条件化推演。`;

      let usage = null;
      const content = await callLlm(cfg, systemPrompt, userPrompt, (_delta, full) => store.setState({ briefingStreamText: full }), u => { usage = u; });
      const record = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        content: content + COMPLIANCE_SUFFIX,
        at: Date.now(),
        // v36.3：自动生成的每日去重依赖此字段（此前缺失导致「当日已生成」检查永不命中、每次进页重复生成）
        generatedAt,
        meta: {
          indexCount: indices?.length || 0, stockCount: stockRows.length, sectorCount: sectorRows.length,
          coverage: coverage?.label || '行情样本', tokens: usage?.total_tokens ?? null,
          watchlistCount: (watchlist || []).length, snapshotCount: snapshots.length,
          snapshots, // v36.3：数据图卡随记录持久化——历史预览可完整重现图表
        },
      };
      store.setState({
        briefing: record,
        briefingLoading: false,
        briefingStreamText: '',
        briefingHistory: (() => {
          const next = [record, ...store.state.briefingHistory].slice(0, BRIEFING_HISTORY_LIMIT);
          persistBriefingHistory(next);
          return next;
        })(),
      });
    } catch (e) {
      store.setState({ briefingError: e.message || '早报生成失败', briefingLoading: false, briefingStreamText: '' });
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
  // 诊断历史管理（列表持久化在 localStorage；查看视图由组件层持有）
  const deleteDiagnosisRecord = useCallback(id => {
    const next = store.state.diagnosisHistory.filter(record => record.id !== id);
    persistDiagnosisHistory(next);
    store.setState({ diagnosisHistory: next });
  }, []);
  const clearDiagnosisHistory = useCallback(() => {
    persistDiagnosisHistory([]);
    store.setState({ diagnosisHistory: [] });
  }, []);
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
    diagnosisStreamText: snapshot.diagnosisStreamText,
    diagnosisHistory: snapshot.diagnosisHistory,
    diagnoseStock, clearDiagnosis, deleteDiagnosisRecord, clearDiagnosisHistory,
    // 早报
    briefingLoading: snapshot.briefingLoading,
    briefing: snapshot.briefing,
    briefingError: snapshot.briefingError,
    briefingStreamText: snapshot.briefingStreamText,
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
