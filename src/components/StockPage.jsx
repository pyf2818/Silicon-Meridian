/**
 * StockPage — 股市动向（三栏行情终端）
 * 左：自选/热门列表  中：分时/K线主图  右：五档盘口 + 指标
 * 数据源：东方财富（主）+ 腾讯（降级）
 */
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ICONS } from '../constants/index.jsx';
import { renderMarkdown } from '../utils/markdown.jsx';
import { useStockWatchlist } from '../hooks/useStockWatchlist.js';
import { useStockAi, ALERT_CONDITIONS } from '../hooks/useStockAi.js';
import { DEFAULT_INVESTOR_POLICY, normalizeInvestorPolicy } from '../domain/stock/investorPolicy.js';
import KLineChart from './stock/KLineChart.jsx';
import { TimelineChart, OrderBook } from './stock/Charts.jsx';
import { ResearchJournal, ResearchChecklist, BriefingContent } from './stock/ResearchTools.jsx';
import { PositionRiskTool, ScenarioAnalysisTool } from './stock/RiskTools.jsx';
import { IntelligenceRadar, InvestorPolicyTool, DecisionEvidenceTool } from './stock/IntelligenceTools.jsx';
import ProCharts from './stock/ProCharts.jsx';
import DiagnosisDrawer from './stock/DiagnosisDrawer.jsx';
import { useStockAiToolFill } from '../hooks/useStockAiToolFill.js';
import { showToast } from '../utils/toast.js';

const UP_COLOR = '#ef4444';
const DOWN_COLOR = '#22c55e';

const PERIOD_OPTIONS = [
  { id: 'timeline', label: '分时' },
  { id: '5', label: '5分' },
  { id: '15', label: '15分' },
  { id: '30', label: '30分' },
  { id: '60', label: '60分' },
  { id: '101', label: '日K' },
  { id: '102', label: '周K' },
  { id: '103', label: '月K' },
];

const BENCHMARK_OPTIONS = [
  { code: 'sh000001', name: '上证指数' },
  { code: 'sz399001', name: '深证成指' },
  { code: 'sz399006', name: '创业板指' },
];

// v31c：研究工具白话说明——每个 tab 一句「这是干嘛的」，解决「看不明白有啥用」
const RESEARCH_TOOL_GUIDE = {
  decision: '一张卡汇总当前个股的评级、多空证据和关键价位——先看这张卡，再决定要不要继续往下研究。',
  policy: '设定你的投资周期、风险偏好和单笔亏损上限，后面的仓位计算和 AI 分析都会按这套约束来。',
  risk: '按你的账户资金和止损价，算出「这一笔最多买多少股」，把单笔亏损锁死在预算内——先算能亏多少，再决定买多少。',
  scenario: '提前把剧本写好：上涨怎么应对、下跌怎么应对、到什么价位做什么动作，临场不靠情绪拍脑袋。',
  checklist: '买之前的自查清单：基本面、资金、风险信号逐项过一遍，全部通过再动手，减少冲动单。',
  journal: '把每次的买入理由写成假设存档，之后复盘验证对与错——这是唯一能让你越亏越聪明的方法。',
};

export default function StockPage({ llmConfig, onOpenLlmConfig, onArchiveMaterial }) {
  const pageRef = useRef(null);
  const { watchlist, inWatchlist, toggleStock, moveStock } = useStockWatchlist();
  const aiState = useStockAi(llmConfig);
  const aiFill = useStockAiToolFill(llmConfig);
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  // v29：选中股票持久化——切页回来 selectedCode 能恢复，diagnosis 的 code 过滤才不会把已有分析判空
  const [selectedCode, setSelectedCode] = useState(() => localStorage.getItem('stockSelectedCode') || 'sh000001');
  const ai = { ...aiState, diagnosis: aiState.diagnosis?.stock?.code === selectedCode ? aiState.diagnosis : null };
  const [selectedName, setSelectedName] = useState(() => localStorage.getItem('stockSelectedName') || '上证指数');
  const [klineData, setKlineData] = useState(null);
  const [diagKlines, setDiagKlines] = useState([]); // 诊断用的日K序列（分时周期下也能让专业图表有数据）
  const [klineLoading, setKlineLoading] = useState(false);
  const [klineError, setKlineError] = useState('');
  const [klineReloadKey, setKlineReloadKey] = useState(0);
  const [timelineData, setTimelineData] = useState(null);
  const [realtime, setRealtime] = useState(null);
  const [marketDataState, setMarketDataState] = useState({ stale: false, unavailable: false, message: '', timestamp: '' });
  const [sectors, setSectors] = useState([]);
  const [sectorType, setSectorType] = useState('industry'); // industry | concept
  const [period, setPeriod] = useState('timeline');
  const [adjust, setAdjust] = useState(() => localStorage.getItem('stockKlineAdjust') || '1');
  const [leftPanelOpen, setLeftPanelOpen] = useState(() => localStorage.getItem('stockLeftPanelOpen') !== 'false');
  // 证据卡折叠移入 DiagnosisDrawer；v29：底部分析 section 已迁移为右侧抽屉
  const [showDiagDrawer, setShowDiagDrawer] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(() => localStorage.getItem('stockRightPanelOpen') !== 'false');
  const [experienceMode, setExperienceMode] = useState(() => localStorage.getItem('stockExperienceMode') || 'beginner');
  const [benchmarkCode, setBenchmarkCode] = useState(() => localStorage.getItem('stockBenchmarkCode') || 'sh000001');
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [investorPolicy, setInvestorPolicy] = useState(() => {
    try { return normalizeInvestorPolicy(JSON.parse(localStorage.getItem('stockInvestorPolicyV1') || '{}')); }
    catch { return { ...DEFAULT_INVESTOR_POLICY }; }
  });

  useEffect(() => { localStorage.setItem('stockKlineAdjust', adjust); }, [adjust]);
  useEffect(() => { localStorage.setItem('stockLeftPanelOpen', String(leftPanelOpen)); }, [leftPanelOpen]);
  useEffect(() => { localStorage.setItem('stockRightPanelOpen', String(rightPanelOpen)); }, [rightPanelOpen]);
  useEffect(() => { localStorage.setItem('stockSelectedCode', selectedCode); localStorage.setItem('stockSelectedName', selectedName); }, [selectedCode, selectedName]);
  useEffect(() => { localStorage.setItem('stockExperienceMode', experienceMode); }, [experienceMode]);
  useEffect(() => { localStorage.setItem('stockBenchmarkCode', benchmarkCode); }, [benchmarkCode]);
  useEffect(() => {
    localStorage.setItem('stockInvestorPolicyV1', JSON.stringify(investorPolicy));
    localStorage.setItem('stockRiskCapital', String(investorPolicy.capital));
    localStorage.setItem('stockRiskPercent', String(investorPolicy.riskPerTrade));
  }, [investorPolicy]);
  useEffect(() => {
    const timer = setInterval(() => setClockNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // 搜索
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [listTab, setListTab] = useState('hot'); // hot | watchlist

  // 早报弹窗
  const [showBriefing, setShowBriefing] = useState(false);
  const [briefingTab, setBriefingTab] = useState('current');
  const [showResearchTools, setShowResearchTools] = useState(false);
  const [researchToolTab, setResearchToolTab] = useState('risk');
  // v31c：header AI 工具下拉（收纳诊断/早报/研究工具，解决顶栏拥挤）
  const [showAiMenu, setShowAiMenu] = useState(false);
  // 监控配置弹窗
  const [showAlertConfig, setShowAlertConfig] = useState(false);
  const [alertConditions, setAlertConditions] = useState(() => {
    try { return JSON.parse(localStorage.getItem('stockAlertConditions') || '{}'); } catch { return {}; }
  });
  const setAlertCondition = (code, condId) => {
    setAlertConditions(prev => {
      const next = { ...prev };
      if (condId) next[code] = condId; else delete next[code];
      try { localStorage.setItem('stockAlertConditions', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const [dRes, sRes] = await Promise.all([
        fetch('/api/stock/dashboard'),
        fetch(`/api/stock/sectors?type=${sectorType}`),
      ]);
      setDashboard(await dRes.json());
      const sd = await sRes.json();
      setSectors(sd?.sectors || []);
    } catch { setDashboard(null); }
    setLoading(false);
  }, [sectorType]);

  // 切换板块类型时重新加载板块数据（不重载大盘）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sRes = await fetch(`/api/stock/sectors?type=${sectorType}`);
        const sd = await sRes.json();
        if (!cancelled) setSectors(sd?.sectors || []);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [sectorType]);

  // 触发 AI 诊断（自动加载日K数据供诊断用）
  const runDiagnosis = useCallback(async () => {
    let klineForDiag = klineData;
    let benchmarkKline = null;
    // 当前是分时图时，临时拉一份日K供诊断
    if (period === 'timeline' || !klineForDiag) {
      try {
        const res = await fetch(`/api/stock/kline?code=${selectedCode}&period=101&count=30&adjust=${adjust}`);
        klineForDiag = await res.json();
      } catch { /* ignore */ }
    }
    setDiagKlines(Array.isArray(klineForDiag?.klines) ? klineForDiag.klines.filter(k => Number.isFinite(k?.close)) : []);
    try {
      const benchmarkResponse = await fetch(`/api/stock/kline?code=${benchmarkCode}&period=101&count=60&adjust=${adjust}`);
      benchmarkKline = await benchmarkResponse.json();
    } catch { /* relative strength remains unavailable */ }
    ai.diagnoseStock({
      stock: { name: selectedName, code: selectedCode },
      kline: klineForDiag,
      benchmarkKline,
      benchmark: BENCHMARK_OPTIONS.find(item => item.code === benchmarkCode),
      realtime,
      sectors,
      experienceMode,
      investorPolicy,
    });
  }, [ai, adjust, benchmarkCode, experienceMode, investorPolicy, klineData, period, selectedCode, selectedName, realtime, sectors]);

  // 触发 AI 早报
  const runBriefing = useCallback(() => {
    ai.generateMorningBrief({
      indices: dashboard?.indices || [],
      stocks: dashboard?.stocks || [],
      sectors,
      coverage: dashboard?.coverage,
      experienceMode,
      investorPolicy,
    });
    setBriefingTab('current');
    setShowBriefing(true);
  }, [ai, dashboard, experienceMode, investorPolicy, sectors]);

  // 首次进入股市页自动生成早报：用户进入页面即可看到当日早报，无需主动点击
  // 条件：有 LLM 配置 + dashboard 已加载 + 当日尚未生成过 + 会话内只触发一次
  const autoBriefingTriggeredRef = useRef(false);
  useEffect(() => {
    if (autoBriefingTriggeredRef.current) return;
    // 必须有 LLM 配置才能调用 AI
    if (!llmConfig?.baseUrl || !llmConfig?.selectedModel) return;
    // dashboard 必须已加载（指数 + 热门股）
    if (!dashboard?.indices || dashboard.indices.length === 0) return;
    // 当日已生成过则跳过（按日期+id 检查 briefingHistory）
    const today = new Date().toLocaleDateString('zh-CN');
    const hasToday = (ai.briefingHistory || []).some(r =>
      r?.generatedAt && new Date(r.generatedAt).toLocaleDateString('zh-CN') === today
    );
    if (hasToday) {
      autoBriefingTriggeredRef.current = true;
      return;
    }
    autoBriefingTriggeredRef.current = true;
    // 静默生成，不弹出 modal（用户可在面板查看进度）
    ai.generateMorningBrief({
      indices: dashboard.indices,
      stocks: dashboard.stocks || [],
      sectors,
      coverage: dashboard.coverage,
      experienceMode,
      investorPolicy,
    });
  }, [llmConfig, dashboard, ai, experienceMode, investorPolicy, sectors]);

  // 触发自选监控
  const runAlerts = useCallback(() => {
    ai.checkAlerts(watchlist, alertConditions);
  }, [ai, watchlist, alertConditions]);

  const normalizeRealtimePayload = payload => {
    if (payload?.ok === false) {
      return {
        realtime: null,
        state: {
          stale: false,
          unavailable: true,
          message: payload?.error?.code === 'MARKET_DATA_UNAVAILABLE' ? '行情数据暂不可用' : (payload?.error?.message || '行情数据暂不可用'),
          timestamp: payload?.timestamp || '',
        },
      };
    }
    const quote = payload?.data || payload?.quote || payload;
    return {
      realtime: quote,
      state: {
        stale: Boolean(payload?.stale),
        unavailable: false,
        message: payload?.stale ? '缓存行情' : '',
        timestamp: payload?.timestamp || quote?.timestamp || '',
      },
    };
  };

  const loadStock = useCallback(async (code) => {
    // 体验优化：不清空旧数据，让 UI 保持上一只股票的图表直到新数据到达，消除白屏
    // 仅重置市场数据状态为"加载中"，realtime/kline/timeline 保留，由新数据覆盖
    setMarketDataState({ stale: false, unavailable: false, message: '', timestamp: '' });
    try {
      // 并行获取 realtime + timeline，比串行快 1 RTT
      const [rRes, tRes] = await Promise.all([
        fetch(`/api/stock/realtime?code=${code}`),
        fetch(`/api/stock/timeline?code=${code}`),
      ]);
      const payload = await rRes.json();
      const normalized = normalizeRealtimePayload(payload);
      setRealtime(normalized.realtime);
      setMarketDataState(normalized.state);
      // 后端若返回真实 name 则更新；否则保留 pickStock 已设的 name，避免用 code 覆盖
      const apiName = normalized.realtime?.name;
      if (apiName) setSelectedName(apiName);
      setTimelineData(await tRes.json());
    } catch {
      setMarketDataState({ stale: false, unavailable: true, message: '行情数据暂不可用', timestamp: '' });
    }
  }, []);

  // 相邻自选股预取：用户切股票时大概率会看列表中的下一只，
  // 提前 fire-and-forget 预取相邻股票的 realtime 到服务端缓存（不更新 UI）
  const prefetchAdjacentStock = useCallback((currentCode) => {
    if (!currentCode) return;
    // 仅在自选股 tab 下预取（热门列表太多不预取）
    if (listTab !== 'watchlist') return;
    const items = watchlist || [];
    const idx = items.findIndex(s => s.code === currentCode || s.secid === currentCode);
    if (idx < 0) return;
    // 预取下一只（环绕到 0）
    const next = items[(idx + 1) % items.length];
    if (next && next.code && next.code !== currentCode) {
      // 用 query 参数标记 prefetch，服务端可识别后只填缓存不返回完整响应
      fetch(`/api/stock/realtime?code=${next.code}&prefetch=1`).catch(() => {});
    }
  }, [listTab, watchlist]);

  // 轻量刷新：只拉实时行情，不清空 K线/分时（定时轮询用）
  const refreshRealtime = useCallback(async (code) => {
    try {
      const rRes = await fetch(`/api/stock/realtime?code=${code}`);
      const payload = await rRes.json();
      const normalized = normalizeRealtimePayload(payload);
      setRealtime(normalized.realtime);
      setMarketDataState(normalized.state);
    } catch { /* ignore */ }
  }, []);

  // A 股交易时段感知：交易时段密集轮询，盘后/周末/节假日降频到 60s 省 95% 请求
  // 时段：周一至周五 9:30-11:30 / 13:00-15:00（北京时间）
  const isMarketOpen = useCallback((now = new Date()) => {
    const day = now.getDay(); // 0=周日, 6=周六
    if (day === 0 || day === 6) return false;
    // 节假日简化处理：春节/国庆等大假需要用户自己感知，这里只判周末
    const minutes = now.getHours() * 60 + now.getMinutes();
    const morning = minutes >= 9 * 60 + 30 && minutes <= 11 * 60 + 30;
    const afternoon = minutes >= 13 * 60 && minutes <= 15 * 60;
    // 9:25-9:30 集合竞价也算"接近开盘"，给个稍慢的频率
    const preOpen = minutes >= 9 * 60 + 25 && minutes < 9 * 60 + 30;
    return morning || afternoon || preOpen;
  }, []);

  // v26.9e 修复：把「是否开盘」抽成**稳定的布尔值**再进依赖数组。
  // 原先四个轮询 effect 的依赖里直接放 clockNow（每 1000ms +1），effect 每 ~1s 重建 →
  // clearInterval 总在回调触发前把定时器清掉 → 2s/5s/10s 的轮询**一次都不会执行**，
  // 行情/大盘/K 线的「实时刷新」形同虚设（数据永远停在首屏）。
  // 派生为布尔后，只有真正跨过开盘/收盘边界时依赖才变化，定时器得以存活。
  const marketOpen = useMemo(() => isMarketOpen(new Date(clockNow)), [isMarketOpen, clockNow]);

  // 实时行情轮询：交易时段 2s，盘后 60s
  useEffect(() => {
    if (!selectedCode) return;
    const interval = marketOpen ? 2000 : 60000;
    const timer = setInterval(() => {
      refreshRealtime(selectedCode);
    }, interval);
    return () => clearInterval(timer);
  }, [selectedCode, refreshRealtime, marketOpen]);

  // 大盘指数轮询：交易时段 5s，盘后 60s
  useEffect(() => {
    if (!dashboard) return;
    const interval = marketOpen ? 5000 : 60000;
    const timer = setInterval(() => loadDashboard(), interval);
    return () => clearInterval(timer);
  }, [dashboard, loadDashboard, marketOpen]);

  // K 线轮询：交易时段 10s，盘后不轮询（K 线盘后不变）
  useEffect(() => {
    if (!selectedCode || period === 'timeline') return;
    if (!marketOpen) return; // 盘后 K 线不会变化，不轮询
    const timer = setInterval(() => setKlineReloadKey(k => k + 1), 10000);
    return () => clearInterval(timer);
  }, [selectedCode, period, marketOpen]);

  // 分时图轮询：交易时段 5s，盘后不轮询
  useEffect(() => {
    if (!selectedCode || period !== 'timeline') return;
    if (!marketOpen) return;
    const timer = setInterval(() => setKlineReloadKey(k => k + 1), 5000);
    return () => clearInterval(timer);
  }, [selectedCode, period, marketOpen]);

  // K线按需加载（切到日K/周K/月K时）
  useEffect(() => {
    if (period === 'timeline' || !selectedCode) return;
    let cancelled = false;
    (async () => {
      setKlineLoading(true);
      setKlineError('');
      setKlineData(null);
      try {
        const count = ['5', '15', '30', '60'].includes(period) ? 240 : 120;
        const res = await fetch(`/api/stock/kline?code=${selectedCode}&period=${period}&count=${count}&adjust=${adjust}`);
        if (!res.ok) throw new Error(`行情接口返回 ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data?.klines) || data.klines.length === 0) throw new Error('上游未返回当前周期数据');
        if (!cancelled) setKlineData(data);
      } catch (error) {
        if (!cancelled) setKlineError(error?.message || 'K 线加载失败');
      } finally {
        if (!cancelled) setKlineLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedCode, period, adjust, klineReloadKey]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);
  useEffect(() => { if (selectedCode) loadStock(selectedCode); }, [selectedCode, loadStock]);

  const doSearch = useCallback(async () => {
    if (!searchKeyword.trim()) { setSearchResults([]); return; }
    try { const res = await fetch(`/api/stock/search?keyword=${encodeURIComponent(searchKeyword)}`); setSearchResults(await res.json()); }
    catch { setSearchResults([]); }
  }, [searchKeyword]);

  // 输入即时搜索（debounce 300ms），不必按回车
  useEffect(() => {
    if (!searchKeyword.trim()) { setSearchResults([]); return; }
    const timer = setTimeout(() => doSearch(), 300);
    return () => clearTimeout(timer);
  }, [searchKeyword, doSearch]);

  const isSelectedInWatchlist = inWatchlist(selectedCode);
  const selectedStock = useMemo(() => ({
    code: selectedCode, name: selectedName,
    secid: realtime?.secid || '',
  }), [selectedCode, selectedName, realtime]);

  const fmtVol = (v) => {
    if (!v) return '--';
    if (v >= 1e8) return (v / 1e8).toFixed(2) + '亿';
    if (v >= 1e4) return (v / 1e4).toFixed(2) + '万';
    return String(v);
  };

  // 关键指标
  const metrics = useMemo(() => {
    if (!realtime) return [];
    const turnover = realtime.amount && realtime.price ? (realtime.amount / (realtime.price * 100)) : null;
    return [
      { label: '今开', value: realtime.open?.toFixed(2) || '--' },
      { label: '最高', value: realtime.high?.toFixed(2) || '--' },
      { label: '最低', value: realtime.low?.toFixed(2) || '--' },
      { label: '昨收', value: realtime.prevClose?.toFixed(2) || '--' },
      { label: '成交量', value: fmtVol(realtime.volume) },
      { label: '成交额', value: fmtVol(realtime.amount) },
    ];
  }, [realtime]);

  // 列表数据（热门或自选）
  const listItems = listTab === 'watchlist' ? watchlist : (dashboard?.stocks || []);
  const quoteUpdatedLabel = realtime?.timestamp
    ? new Date(realtime.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '--:--:--';
  const marketClockLabel = new Date(clockNow).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const breadth = useMemo(() => {
    const stocks = dashboard?.stocks || [];
    const up = stocks.filter(s => s.changePct > 0).length;
    const down = stocks.filter(s => s.changePct < 0).length;
    return { up, down, flat: Math.max(stocks.length - up - down, 0), total: stocks.length };
  }, [dashboard]);
  const marketRead = useMemo(() => {
    const index = dashboard?.indices?.[0];
    const change = index?.changePct ?? realtime?.changePct;
    const positive = (change ?? 0) >= 0;
    const crowded = breadth.total > 0 && breadth.down / breadth.total > 0.55;
    return {
      tone: crowded ? '谨慎' : positive ? '偏强' : '偏弱',
      toneClass: crowded ? 'caution' : positive ? 'positive' : 'negative',
      reason: crowded ? '当前热门样本中下跌占比较高' : positive ? '主要指数与当前热门样本偏强' : '主要指数走弱，先观察支撑是否有效',
      action: crowded ? '观察量能与止跌信号' : positive ? '关注强势板块能否延续' : '关注是否出现企稳信号',
      confidence: breadth.total >= 20 ? '中等置信度' : '低置信度',
    };
  }, [breadth, dashboard, realtime]);
  const modeGuide = useMemo(() => {
    const hasDiagnosis = ai.diagnosis?.status === 'ready';
    if (experienceMode === 'pro') {
      return {
        eyebrow: '\u4e13\u4e1a\u7814\u7a76\u53f0',
        title: hasDiagnosis ? `\u8bc1\u636e\u94fe\u5df2\u5c31\u7eea\uff1a${ai.diagnosis.rating}` : '\u4ece\u6570\u636e\u5230\u51b3\u7b56',
        description: '\u5148\u786e\u8ba4\u6570\u636e\u8986\u76d6\u548c\u6bd4\u8f83\u57fa\u51c6\uff0c\u518d\u7528\u8bc1\u636e\u3001\u98ce\u9669\u548c\u5931\u6548\u6761\u4ef6\u590d\u6838\u5047\u8bbe\u3002',
        steps: ['\u786e\u8ba4\u6bd4\u8f83\u57fa\u51c6\u4e0e\u6570\u636e\u8986\u76d6', '\u8fd0\u884c\u8bca\u65ad\uff0c\u6838\u5bf9\u652f\u6301/\u53cd\u5411\u8bc1\u636e', '\u7528\u98ce\u9669\u9884\u7b97\u548c\u60c5\u666f\u63a8\u6f14\u590d\u6838\u5047\u8bbe'],
      };
    }
    return {
      eyebrow: '\u65b0\u624b\u5bfc\u822a',
      title: marketRead.tone === '\u8c28\u614e' ? '\u5148\u5b66\u4f1a\u8bc6\u522b\u98ce\u9669' : marketRead.tone === '\u504f\u5f3a' ? '\u5f3a\u52bf\u4e2d\u4e5f\u8981\u5148\u770b\u98ce\u9669' : '\u5148\u7406\u89e3\u884c\u60c5\u518d\u505a\u5224\u65ad',
      description: 'AI \u4f1a\u628a\u6307\u6807\u7ffb\u8bd1\u6210\u767d\u8bdd\uff0c\u5e2e\u4f60\u5148\u770b\u61c2\u3001\u518d\u89c2\u5bdf\uff0c\u4e0d\u628a\u6da8\u8dcc\u76f4\u63a5\u7b49\u540c\u4e8e\u4e70\u5356\u4fe1\u53f7\u3002',
      steps: ['\u5148\u770b\u5927\u76d8\u4e0e\u6da8\u8dcc\u5bb6\u6570', '\u518d\u770b\u4e00\u53ea\u80a1\u7968\u7684\u8d8b\u52bf\u548c\u6ce2\u52a8', '\u6700\u540e\u68c0\u67e5\u98ce\u9669\u4e0e\u4e2a\u4eba\u7b56\u7565\u662f\u5426\u5339\u914d'],
    };
  }, [ai.diagnosis, experienceMode, marketRead]);

  // 一键存档：把 AI/算法分析整份存入素材库（addManualMaterial），带模式与证据结构
  const archiveDiagnosis = useCallback(() => {
    const d = ai.diagnosis;
    if (!d || !onArchiveMaterial) return;
    const m = d.metrics || {};
    onArchiveMaterial({
      title: `股市AI分析：${d.stock?.name || selectedName}（${d.stock?.code || selectedCode}）`,
      content: d.content || d.summary || '',
      fullContent: [
        `# 股市AI分析：${d.stock?.name || selectedName}（${d.stock?.code || selectedCode}）`,
        `分析模式：${d.mode === 'ai' ? 'AI 增强' : '确定性算法'} ｜ 版本：${experienceMode === 'pro' ? '专业版' : '新手版'}`,
        `评级：${d.rating} ｜ 风险：${d.risk}`,
        '',
        d.content || '',
        '',
        '## 关键指标',
        `MA5/10/20：${m.ma5 ?? '--'}/${m.ma10 ?? '--'}/${m.ma20 ?? '--'}；波动率：${m.volatility ?? '--'}%；支撑/压力：${m.support ?? '--'}/${m.resistance ?? '--'}`,
        '',
        '## 多空证据',
        ...(d.bullCase || []).map(x => `- 支持：${x}`),
        ...(d.bearCase || []).map(x => `- 反向：${x}`),
        ...(d.invalidation || []).map(x => `- 失效条件：${x}`),
      ].join('\n'),
      type: 'viewpoint',
      source: '股市 AI 分析',
      tags: ['股市', 'AI分析', experienceMode === 'pro' ? '专业版' : '新手版'],
      metadata: { kind: 'stock-analysis', code: selectedCode, stockName: d.stock?.name || selectedName, mode: d.mode || 'algorithm', experienceMode, at: d.at || Date.now() },
    });
    // 明确的成功反馈：保存后立即 toast，让用户知晓已入素材库
    showToast(`已存入素材库：股市AI分析 · ${d.stock?.name || selectedName}`);
  }, [ai.diagnosis, onArchiveMaterial, selectedCode, selectedName, experienceMode]);

  // 一键存档：AI 市场早报
  const archiveBriefing = useCallback(() => {
    const b = ai.briefing;
    if (!b || !onArchiveMaterial) return;
    onArchiveMaterial({
      title: `AI市场早报 ${new Date(b.at).toLocaleDateString('zh-CN')}`,
      content: b.content,
      fullContent: b.content,
      type: 'viewpoint',
      source: 'AI 市场早报',
      tags: ['股市', 'AI早报', b.meta?.coverage || '行情样本'],
      metadata: { kind: 'stock-briefing', coverage: b.meta?.coverage, stockCount: b.meta?.stockCount, at: b.at },
    });
    showToast(`已存入素材库：AI市场早报 ${new Date(b.at).toLocaleDateString('zh-CN')}`);
  }, [ai.briefing, onArchiveMaterial]);

  const pickStock = (code, name) => {
    setSelectedCode(code);
    // 立即更新名称，避免依赖 loadStock 异步回调（接口异常时 name 会变成 code）
    if (name) setSelectedName(name);
    setSearchKeyword('');
    setSearchResults([]);
    // 预取下一只自选股，下次切换时直接命中服务端缓存
    prefetchAdjacentStock(code);
  };
  const scrollTo = ref => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const openResearchTools = tab => {
    setResearchToolTab(tab);
    setShowResearchTools(true);
  };

  return (
    <div ref={pageRef} className="stock-page stock-page-v3">
      {/* 顶栏 */}
      <header className="stock3-header">
        <div className="stock3-search">
          {ICONS.search}
          <input
            value={searchKeyword}
            onChange={e => setSearchKeyword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doSearch()}
            placeholder="搜索股票代码/名称（如 600519 / 茅台 / AAPL）"
          />
          {searchResults.length > 0 && (
            <>
              <div className="dropdown-backdrop" onClick={() => setSearchResults([])} />
              <div className="stock-search-dropdown">
                {searchResults.map(s => {
                  const inList = inWatchlist(s.code);
                  return (
                    <div key={s.secid} className="stock-search-item">
                      <button className="stock-search-main" onClick={() => pickStock(s.code, s.name)}>
                        <span className="stock-search-code">{s.code}</span>
                        <span className="stock-search-name">{s.name}</span>
                        <span className="stock-search-market">{s.market}</span>
                      </button>
                      <button
                        className={`stock-search-add ${inList ? 'in-list' : ''}`}
                        onClick={() => { toggleStock({ code: s.code, name: s.name, secid: s.secid }); setSearchResults([]); setSearchKeyword(''); }}
                        title={inList ? '已自选，点击移除' : '加入自选'}
                      >
                        {inList ? '✓' : '+'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
        <div className="stock3-data-status" title={`数据源：${realtime?.dataSource || '等待行情'}；最近拉取：${quoteUpdatedLabel}；个股每 2 秒轮询，图表每 5-10 秒刷新`}>
          <span className={`stock3-data-dot ${realtime ? 'live' : ''}`} />
          <span>{marketDataState.stale ? '缓存行情' : marketDataState.unavailable ? '行情不可用' : '实时行情'} {marketClockLabel}</span>
        </div>
        <div className="stock3-experience-switch" role="tablist" aria-label="使用模式">
          <button type="button" className={experienceMode === 'beginner' ? 'active' : ''} onClick={() => setExperienceMode('beginner')} role="tab" aria-selected={experienceMode === 'beginner'}>新手</button>
          <button type="button" className={experienceMode === 'pro' ? 'active' : ''} onClick={() => setExperienceMode('pro')} role="tab" aria-selected={experienceMode === 'pro'}>专业</button>
        </div>
        <button className={`stock-watch-btn ${isSelectedInWatchlist ? 'active' : ''}`} onClick={() => toggleStock(selectedStock)} title={isSelectedInWatchlist ? '移出自选' : '加入自选'}>
          {ICONS.star}<span>{isSelectedInWatchlist ? '已自选' : '加自选'}</span>
        </button>
        <button
          type="button"
          className={`stock-ai-action ${showAiMenu ? 'active' : ''}`}
          onClick={() => setShowAiMenu(v => !v)}
          title="AI 工具：诊断 / 早报 / 研究工具"
        >
          {ICONS.sparkle}<span>AI 工具</span>
        </button>
        {showAiMenu && (
          <>
            <div className="dropdown-backdrop" onClick={() => setShowAiMenu(false)} />
            <div className="stock-ai-menu" onMouseLeave={() => setShowAiMenu(false)}>
              <button type="button" onClick={() => { setShowAiMenu(false); setShowDiagDrawer(true); }}>
                {ICONS.sparkle}<b>AI 诊断</b><small>买卖参考价 · 剧本 · 历史</small>
              </button>
              <button type="button" onClick={() => { setShowAiMenu(false); setBriefingTab(ai.briefing ? 'current' : ai.briefingHistory.length ? 'history' : 'current'); setShowBriefing(true); }}>
                {ICONS.sparkle}<b>AI 市场早报</b><small>今日大盘 · 板块 · 风险清单</small>
              </button>
              {experienceMode === 'pro' && (
                <button type="button" onClick={() => { setShowAiMenu(false); openResearchTools('decision'); }}>
                  {ICONS.document}<b>研究工具</b><small>决策卡 · 仓位 · 情景 · 清单</small>
                </button>
              )}
            </div>
          </>
        )}
        <button className="btn-refresh" onClick={loadDashboard}>{ICONS.refresh}<span>刷新</span></button>
      </header>

      {(marketDataState.stale || marketDataState.unavailable) && (
        <div className={`stock-market-state ${marketDataState.unavailable ? 'error' : 'stale'}`}>
          <strong>{marketDataState.message}</strong>
          {marketDataState.timestamp && <span>{new Date(marketDataState.timestamp).toLocaleString('zh-CN')}</span>}
        </div>
      )}

      {/* 大盘指数横条 */}
      {/* 大盘指数横条 + 涨跌家数 */}
      <section className="stock3-indices">
        {loading && !dashboard
          ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="stock3-index-skeleton-card" />)
          : (dashboard?.indices || []).map(idx => (
            <button key={idx.secid} className={`stock3-index ${idx.changePct >= 0 ? 'up' : 'down'} ${selectedCode === idx.code ? 'active' : ''}`} onClick={() => setSelectedCode(idx.code)}>
              <span className="idx-name">{idx.name}</span>
              <span key={idx.price} className="idx-price price-flash">{idx.price?.toFixed(2)}</span>
              <span className="idx-chg">{idx.changePct >= 0 ? '+' : ''}{idx.changePct?.toFixed(2)}%</span>
            </button>
          ))}
        {dashboard?.stocks && (
          <div className="stock3-breadth">
            {(() => {
              const up = dashboard.stocks.filter(s => s.changePct > 0).length;
              const down = dashboard.stocks.filter(s => s.changePct < 0).length;
              const flat = dashboard.stocks.length - up - down;
              return <>
                <span className="breadth-label">活跃样本</span>
                <span className="breadth-up">↑{up}</span>
                <span className="breadth-flat">—{flat}</span>
                <span className="breadth-down">↓{down}</span>
              </>;
            })()}
          </div>
        )}
      </section>

      {experienceMode === 'beginner' && (
        <section className="stock3-coach" aria-label="市场摘要">
          <div className="stock3-coach-lead">
            <span className="stock3-coach-kicker">样本状态</span>
            <strong className={marketRead.toneClass}>{marketRead.tone}</strong>
            <span>{marketRead.reason}</span>
          </div>
          <div className="stock3-coach-item">
            <span>今天先看</span>
            <strong>{marketRead.action}</strong>
          </div>
          <div className="stock3-coach-item">
            <span>涨跌家数</span>
            <strong><em className="up">{breadth.up} 涨</em><em className="down">{breadth.down} 跌</em></strong>
          </div>
          <div className="stock3-coach-note" title={`${dashboard?.coverage?.label || '行情样本'}，不代表全市场广度`}><strong>{marketRead.confidence}</strong><span>指数 + {breadth.total} 只活跃样本</span></div>
        </section>
      )}
      {experienceMode === 'pro' && (
        <>
          <section className="stock-data-scope" aria-label="数据覆盖范围">
            <strong>数据覆盖</strong>
            <span>轮询行情：主要指数 + {breadth.total} 只{dashboard?.coverage?.label || '行情样本'}</span>
            <span>频率：个股 10 秒 / 样本池 {dashboard?.coverage?.realtimePollingSeconds || 30} 秒</span>
            <span>研究数据：价格、成交量、K 线</span>
            <label className="stock-benchmark-select">比较基准
              <select value={benchmarkCode} onChange={event => setBenchmarkCode(event.target.value)}>
                {BENCHMARK_OPTIONS.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}
              </select>
            </label>
            <span className="limited">非交易所逐笔；暂未覆盖全市场广度、财务、公告、资金流</span>
          </section>
          <nav className="stock-research-workflow" aria-label="专业研究流程">
            <span>研究流程</span>
            <button type="button" onClick={() => scrollTo(pageRef)}><b>1</b>行情</button>
            <i>→</i>
            <button type="button" onClick={() => setShowDiagDrawer(true)}><b>2</b>AI 诊断</button>
            <i>→</i>
            <button type="button" onClick={() => openResearchTools('risk')}><b>3</b>风险预算</button>
            <i>→</i>
            <button type="button" onClick={() => openResearchTools('journal')}><b>4</b>假设账本与复盘</button>
          </nav>
        </>
      )}

      <section className={`stock-mode-guide ${experienceMode}`} aria-label={modeGuide.eyebrow}>
        <div className="stock-mode-guide-lead">
          <span className="stock-mode-guide-eyebrow">{modeGuide.eyebrow}</span>
          <strong>{modeGuide.title}</strong>
          <p>{modeGuide.description}</p>
        </div>
        <div className="stock-mode-guide-steps">
          {modeGuide.steps.map((step, index) => <div key={step}><b>{index + 1}</b><span>{step}</span></div>)}
        </div>
        <button type="button" className="stock-mode-guide-ai" onClick={experienceMode === 'pro' ? () => { setShowDiagDrawer(true); runDiagnosis(); } : () => { setBriefingTab('current'); setShowBriefing(true); }}>
          {ICONS.sparkle}<span>{experienceMode === 'pro' ? (ai.diagnosis ? '\u91cd\u65b0\u8fd0\u884c\u8bca\u65ad' : '\u8fd0\u884c AI \u8bca\u65ad') : '\u6253\u5f00 AI \u65e9\u62a5'}</span>
        </button>
      </section>

      <IntelligenceRadar
        dashboard={dashboard}
        sectors={sectors}
        selectedCode={selectedCode}
        onSelect={pickStock}
        onInspect={(code, name) => { pickStock(code, name); setResearchToolTab('decision'); setShowResearchTools(true); }}
        policy={investorPolicy}
        experienceMode={experienceMode}
      />

      {/* 板块涨幅榜（行业/概念切换） */}
      <section className="stock3-sectors">
        <div className="stock3-sectors-head">
          <span className="stock3-sectors-label">板块轮动</span>
          <div className="stock3-sectors-tabs">
            <button className={`stock3-sector-tab ${sectorType === 'industry' ? 'active' : ''}`} onClick={() => setSectorType('industry')}>行业</button>
            <button className={`stock3-sector-tab ${sectorType === 'concept' ? 'active' : ''}`} onClick={() => setSectorType('concept')}>概念</button>
          </div>
        </div>
        <div className="stock3-sectors-strip">
          {loading && sectors.length === 0
            ? Array.from({ length: 10 }).map((_, i) => <div key={i} className="stock3-sector-skeleton" />)
            : sectors.slice(0, 12).map(s => (
              <div key={s.code} className={`stock3-sector ${s.changePct >= 0 ? 'up' : 'down'}`} title={`${s.name} ${s.changePct >= 0 ? '+' : ''}${s.changePct?.toFixed(2)}%`}>
                <span className="sector-name">{s.name}</span>
                <span className="sector-chg">{s.changePct >= 0 ? '+' : ''}{s.changePct?.toFixed(2)}%</span>
              </div>
            ))}
          {!loading && sectors.length === 0 && <span className="stock3-sector-empty">暂无板块数据</span>}
        </div>
      </section>

      {/* 三栏主体 */}
      <div className={`stock3-body ${leftPanelOpen ? '' : 'no-left'} ${rightPanelOpen ? '' : 'no-right'}`}>
        {/* 左栏：列表 */}
        {leftPanelOpen && <aside className="stock3-left">
          <div className="stock3-left-tabs">
            <button className={`stock3-left-tab ${listTab === 'hot' ? 'active' : ''}`} onClick={() => setListTab('hot')}>活跃 {breadth.total > 0 && `(${breadth.total})`}</button>
            <button className={`stock3-left-tab ${listTab === 'watchlist' ? 'active' : ''}`} onClick={() => setListTab('watchlist')}>自选 {watchlist.length > 0 && `(${watchlist.length})`}</button>
            {listTab === 'watchlist' && watchlist.length > 0 && (
              <button className="stock3-left-tab stock-alert-tab" onClick={() => setShowAlertConfig(true)} title="智能监控配置">
                {ICONS.sparkle}<span>监控</span>
              </button>
            )}
          </div>
          {listTab === 'watchlist' && ai.alertResults.length > 0 && (
            <div className="stock-alert-hits">
              <div className="stock-alert-hits-label">命中提醒</div>
              {ai.alertResults.map((h, i) => (
                <div key={i} className={`stock-alert-hit ${(h.realtime.changePct || 0) >= 0 ? 'up' : 'down'}`}>
                  <strong>{h.stock.name}</strong>
                  <span className="stock-alert-hit-price">{h.realtime.price?.toFixed(2)} ({h.realtime.changePct >= 0 ? '+' : ''}{h.realtime.changePct?.toFixed(2)}%)</span>
                  <p>{h.aiText}</p>
                </div>
              ))}
            </div>
          )}
          <div className="stock3-left-list">
            {listTab === 'watchlist' && watchlist.length === 0 && (
              <div className="stock3-list-empty">还没有自选，搜索个股后点「加自选」</div>
            )}
            {listItems.map(s => (
              <button key={s.code} className={`stock3-list-item ${selectedCode === s.code ? 'active' : ''} ${(s.changePct || 0) >= 0 ? 'up' : 'down'}`} onClick={() => pickStock(s.code, s.name)} title={s.name}>
                <div className="li-left">
                  <span className="li-name">{s.name}</span>
                  <span className="li-code">{s.code}</span>
                </div>
                <div className="li-right">
                  <span className="li-price">{s.price?.toFixed(2)}</span>
                  <span className="li-chg">{s.changePct !== undefined ? `${s.changePct >= 0 ? '+' : ''}${s.changePct.toFixed(2)}%` : '--'}</span>
                </div>
              </button>
            ))}
          </div>
        </aside>}

        {/* 中栏：主图 */}
        <main className="stock3-main">
          <div className="stock3-chart-head">
            <div className="stock3-title">
              <h2>{selectedName}</h2>
              <span className="stock3-code">{selectedCode}</span>
              {realtime && (
                <span className={`stock3-price ${realtime.changePct >= 0 ? 'up' : 'down'}`}>
                  <strong key={realtime.price} className={`price-flash ${realtime.changePct >= 0 ? 'flash-up' : 'flash-down'}`}>{realtime.price?.toFixed(2)}</strong>
                  <em>{realtime.change >= 0 ? '+' : ''}{realtime.change?.toFixed(2)} ({realtime.changePct >= 0 ? '+' : ''}{realtime.changePct?.toFixed(2)}%)</em>
                </span>
              )}
            </div>
            <div className="stock3-chart-toolbar">
              <div className="stock3-period">
                {PERIOD_OPTIONS.map(p => (
                  <button key={p.id} className={`stock3-period-btn ${period === p.id ? 'active' : ''}`} onClick={() => setPeriod(p.id)}>{p.label}</button>
                ))}
              </div>
              {period !== 'timeline' && (
                <>
                  <label className="stock3-adjust">
                    <span>复权</span>
                    <select value={adjust} onChange={event => setAdjust(event.target.value)}>
                      <option value="0">不复权</option>
                      <option value="1">前复权</option>
                      <option value="2">后复权</option>
                    </select>
                  </label>
                  <span className={`stock-kline-status ${klineError ? 'error' : ''}`} title={klineData?.klines?.at(-1)?.date || klineError || ''}>
                    {klineLoading ? '加载中' : klineError ? '数据异常' : `${klineData?.klines?.length || 0} 根`}
                  </span>
                </>
              )}
              <div className="stock3-layout-tools" aria-label="工作区布局">
                <button type="button" className={leftPanelOpen ? '' : 'active'} onClick={() => setLeftPanelOpen(value => !value)} title={leftPanelOpen ? '隐藏股票列表' : '显示股票列表'} aria-pressed={!leftPanelOpen}>
                  {leftPanelOpen ? ICONS.chevronLeft : ICONS.chevronRight}
                </button>
                <button type="button" className={rightPanelOpen ? '' : 'active'} onClick={() => setRightPanelOpen(value => !value)} title={rightPanelOpen ? '隐藏盘口指标' : '显示盘口指标'} aria-pressed={!rightPanelOpen}>
                  {rightPanelOpen ? ICONS.chevronRight : ICONS.chevronLeft}
                </button>
                <button
                  type="button"
                  className={!leftPanelOpen && !rightPanelOpen ? 'active' : ''}
                  onClick={() => {
                    const focused = !leftPanelOpen && !rightPanelOpen;
                    setLeftPanelOpen(focused);
                    setRightPanelOpen(focused);
                  }}
                  title={!leftPanelOpen && !rightPanelOpen ? '恢复三栏' : '专注图表'}
                  aria-pressed={!leftPanelOpen && !rightPanelOpen}
                >
                  {ICONS.grid}
                </button>
              </div>
            </div>
          </div>
          <div className="stock3-chart-wrap">
            {period === 'timeline'
              ? <TimelineChart points={timelineData?.points} preClose={timelineData?.preClose} />
              : <KLineChart
                  klineData={klineData}
                  period={period}
                  code={selectedCode}
                  layoutKey={`${leftPanelOpen}-${rightPanelOpen}`}
                  loading={klineLoading}
                  error={klineError}
                  onRetry={() => setKlineReloadKey(key => key + 1)}
                />}
          </div>
        </main>

        {/* 右栏：盘口 + 指标 */}
        {rightPanelOpen && <aside className="stock3-right">
          <section className="stock3-panel">
            <div className="stock3-panel-label" title="买卖双方当前挂单价格和数量">五档盘口 <span className="stock-help-dot">?</span></div>
            <OrderBook realtime={realtime} />
          </section>
          <section className="stock3-panel">
            <div className="stock3-panel-label" title="当日开盘、最高、最低、昨收和成交数据">关键指标 <span className="stock-help-dot">?</span></div>
            <div className="stock3-metrics">
              {metrics.map(m => (
                <div key={m.label} className="stock3-metric"><span>{m.label}</span><strong>{m.value}</strong></div>
              ))}
            </div>
          </section>
        </aside>}
      </div>

      {/* v29：AI 诊断右侧抽屉（原底部 section 迁移，含历史记录管理） */}
      <DiagnosisDrawer
        open={showDiagDrawer}
        onClose={() => setShowDiagDrawer(false)}
        ai={ai}
        selectedName={selectedName}
        selectedCode={selectedCode}
        experienceMode={experienceMode}
        diagKlines={diagKlines}
        klineData={klineData}
        runDiagnosis={runDiagnosis}
        archiveDiagnosis={archiveDiagnosis}
        onArchiveMaterial={onArchiveMaterial}
        onOpenLlmConfig={onOpenLlmConfig}
        canRun={!!realtime && !marketDataState.unavailable}
        streamText={ai.diagnosisStreamText || ''}
      />

      {showResearchTools && (
        <div className="stock-modal-overlay" onClick={() => setShowResearchTools(false)}>
          <div className="stock-modal stock-research-modal" onClick={event => event.stopPropagation()}>
            <div className="stock-modal-head">
              <h3>{ICONS.document} 研究工具 · {selectedName}</h3>
              <button className="stock-modal-close" onClick={() => setShowResearchTools(false)}>×</button>
            </div>
            <div className="stock-research-modal-tabs" role="tablist">
              <button type="button" className={researchToolTab === 'decision' ? 'active' : ''} onClick={() => setResearchToolTab('decision')} role="tab">智能决策卡</button>
              <button type="button" className={researchToolTab === 'policy' ? 'active' : ''} onClick={() => setResearchToolTab('policy')} role="tab">投资约束</button>
              <button type="button" className={researchToolTab === 'risk' ? 'active' : ''} onClick={() => setResearchToolTab('risk')} role="tab">仓位预算</button>
              <button type="button" className={researchToolTab === 'scenario' ? 'active' : ''} onClick={() => setResearchToolTab('scenario')} role="tab">情景推演</button>
              <button type="button" className={researchToolTab === 'checklist' ? 'active' : ''} onClick={() => setResearchToolTab('checklist')} role="tab">研究清单</button>
              <button type="button" className={researchToolTab === 'journal' ? 'active' : ''} onClick={() => setResearchToolTab('journal')} role="tab">假设账本</button>
            </div>
            <p className="stock-research-guide">{RESEARCH_TOOL_GUIDE[researchToolTab]}</p>
            <div className="stock-modal-body">
              {researchToolTab === 'decision' ? (
                <DecisionEvidenceTool stock={selectedStock} realtime={realtime} diagnosis={ai.diagnosis} evidencePacket={ai.diagnosis?.evidencePacket} diagnosing={ai.diagnosing} onAnalyze={runDiagnosis} onOpenTool={setResearchToolTab} />
              ) : researchToolTab === 'policy' ? (
                <InvestorPolicyTool policy={investorPolicy} onSave={setInvestorPolicy} />
              ) : researchToolTab === 'risk' ? (
                <PositionRiskTool code={selectedCode} realtime={realtime} diagnosis={ai.diagnosis} />
              ) : researchToolTab === 'scenario' ? (
                <ScenarioAnalysisTool code={selectedCode} name={selectedName} realtime={realtime} diagnosis={ai.diagnosis} aiFill={aiFill} />
              ) : researchToolTab === 'checklist' ? (
                <ResearchChecklist code={selectedCode} name={selectedName} realtime={realtime} diagnosis={ai.diagnosis} aiFill={aiFill} />
              ) : (
                <ResearchJournal code={selectedCode} name={selectedName} realtime={realtime} diagnosis={ai.diagnosis} aiFill={aiFill} />
              )}
            </div>
          </div>
        </div>
      )}

      {/* AI 早报弹窗 */}
      {showBriefing && (
        <div className="stock-modal-overlay" onClick={() => setShowBriefing(false)}>
          <div className="stock-modal stock-briefing-modal" onClick={e => e.stopPropagation()}>
            <div className="stock-modal-head">
              <h3>{ICONS.sparkle} AI 市场早报</h3>
              <button className="stock-modal-close" onClick={() => setShowBriefing(false)}>×</button>
            </div>
            <div className="stock-briefing-tabs" role="tablist">
              <button type="button" className={briefingTab === 'current' ? 'active' : ''} onClick={() => setBriefingTab('current')} role="tab">当前报告</button>
              <button type="button" className={briefingTab === 'history' ? 'active' : ''} onClick={() => setBriefingTab('history')} role="tab">历史归档 ({ai.briefingHistory.length})</button>
            </div>
            <div className="stock-modal-body">
              {briefingTab === 'history' ? (
                <div className="stock-briefing-history">
                  <div className="stock-briefing-history-head">
                    <span>本地保存最近 30 份报告</span>
                    <button type="button" disabled={ai.briefingHistory.length === 0} onClick={() => window.confirm('确认清空全部 AI 早报历史？') && ai.clearBriefingHistory()}>清空</button>
                  </div>
                  {ai.briefingHistory.length === 0 ? <div className="stock-ai-guide"><p>暂无历史报告。</p></div> : ai.briefingHistory.map(record => (
                    <div className="stock-briefing-history-row" key={record.id}>
                      <button type="button" className="stock-briefing-history-open" onClick={() => { ai.openBriefing(record); setBriefingTab('current'); }}>
                        <strong>{new Date(record.at).toLocaleString('zh-CN')}</strong>
                        <span>{record.meta?.coverage || '行情样本'} · {record.meta?.stockCount || 0} 只股票 · {record.meta?.sectorCount || 0} 个板块</span>
                        <p>{record.content.replace(/[#*\n]/g, ' ').slice(0, 90)}...</p>
                      </button>
                      <button type="button" className="stock-briefing-history-delete" onClick={() => ai.deleteBriefing(record.id)} title="删除这份早报">{ICONS.trash}</button>
                    </div>
                  ))}
                </div>
              ) : ai.briefingLoading ? (
                ai.briefingStreamText ? (
                  <div className="stock-diag-streaming">
                    <BriefingContent content={ai.briefingStreamText} />
                    <div className="stock-diag-streaming-hint"><span className="stock-diag-streaming-dot" />早报正在逐字生成…</div>
                  </div>
                ) : (
                  <div className="stock-ai-loading"><div className="spinner" /><span>正在生成早报…</span></div>
                )
              ) : ai.briefingError ? (
                <div className="stock-ai-error">{ai.briefingError}<button onClick={runBriefing}>重试</button></div>
              ) : ai.briefing ? (
                <>
                  <div className="stock-briefing-meta"><span>{new Date(ai.briefing.at).toLocaleString('zh-CN')}</span><span>{ai.briefing.meta?.coverage || '行情样本'} · {ai.briefing.meta?.stockCount || 0} 只</span>{ai.briefing.meta?.tokens != null && <span>Token {ai.briefing.meta.tokens}</span>}{onArchiveMaterial && <button type="button" className="stock-ai-archive" onClick={archiveBriefing} title="把这份早报存入素材库">{ICONS.bookmark}<span>存档</span></button>}</div>
                  <BriefingContent content={ai.briefing.content} />
                </>
              ) : !ai.llmReady ? (
                <div className="stock-ai-guide">
                  <p>配置大模型后可生成新早报；已保存的报告仍可在历史归档中查看。</p>
                  <button onClick={() => { setShowBriefing(false); onOpenLlmConfig?.(); }}>配置大模型</button>
                </div>
              ) : (
                <div className="stock-ai-guide"><p>生成一份包含指数、样本广度、板块轮动、关键个股、多空情景、风险和观察清单的深度早报。</p></div>
              )}
            </div>
            {ai.llmReady && !ai.briefingLoading && (
              <div className="stock-modal-foot">
                <button className="stock-ai-run" onClick={runBriefing}>{ICONS.refresh}<span>生成新早报</span></button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 智能监控配置弹窗 */}
      {showAlertConfig && (
        <div className="stock-modal-overlay" onClick={() => setShowAlertConfig(false)}>
          <div className="stock-modal stock-alert-modal" onClick={e => e.stopPropagation()}>
            <div className="stock-modal-head">
              <h3>{ICONS.sparkle} 自选股智能监控</h3>
              <button className="stock-modal-close" onClick={() => setShowAlertConfig(false)}>×</button>
            </div>
            <div className="stock-modal-body">
              {!ai.llmReady ? (
                <div className="stock-ai-guide">
                  <p>配置大模型后，AI 可监控自选股异动并生成提醒。</p>
                  <button onClick={() => { setShowAlertConfig(false); onOpenLlmConfig?.(); }}>配置大模型</button>
                </div>
              ) : watchlist.length === 0 ? (
                <div className="stock-ai-guide"><p>还没有自选股，先添加自选再设置监控。</p></div>
              ) : (
                <>
                  <div className="stock-alert-run-bar">
                    <span>为每只自选股设置监控条件，AI 命中后生成提醒文案。</span>
                    <button className="stock-ai-run" onClick={runAlerts} disabled={ai.alertChecking}>
                      {ai.alertChecking ? '检查中…' : '立即检查'}
                    </button>
                  </div>
                  <div className="stock-alert-config-list">
                    {watchlist.map(s => (
                      <div key={s.code} className="stock-alert-config-row">
                        <div className="stock-alert-config-name">
                          <strong>{s.name}</strong>
                          <span>{s.code}</span>
                        </div>
                        <select value={alertConditions[s.code] || ''} onChange={e => setAlertCondition(s.code, e.target.value)}>
                          <option value="">不监控</option>
                          {ALERT_CONDITIONS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
