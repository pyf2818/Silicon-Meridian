// src/components/profile/ProfileInsightsSection.jsx
// 行为洞察 v2 —— 「洞察台 INSIGHT DECK」
//
// 上一版是「两张图 + 一列裸 tag」：趋势线是唯一的可视化，其余全是文字标签，
// 数据密度和结论强度完全不成比例。这一版与认知星图同一设计语言（Panel/Tele），
// 但回答不同的问题——罗盘回答「你是什么形状」，洞察台回答「证据有多硬」：
//   · 提问模式/兴趣/来源/关键词 全部换成名次加权条（长度可比，不是字号戏法）
//   · 表达偏好从 chip 升级为强度计（结论 + 结论硬度同时可见）
//   · 新增会话习惯瓦片（totalSessions/avgRounds 等，此前从未被展示）
//   · 最近关注实体带观测次数与时间，可核对的证据链
import { useMemo } from 'react';
import { ICONS } from '../../constants/index.jsx';
import { HudLineChart } from './charts/HudCharts.jsx';
import { useThemeColors } from '../../hooks/useThemeColors.js';
import { computeReadingProfile, withInterestLabels } from '../../utils/profileModel.js';
import { Panel, Tele, Brand } from './charts/AtlasShell.jsx';
import { WeightedBars, PreferenceMeters, SessionTiles } from './charts/InsightPanels.jsx';

const PATTERN_LABELS = {
  compare: '对比分析', analyze: '深度拆解', summarize: '总结归纳', how: '操作方法',
  what: '概念解释', why: '探究原因', predict: '趋势预测', evaluate: '评估判断',
  list: '清单列举', create: '创作生成',
};

function relTime(lastAt) {
  if (!lastAt) return '';
  try {
    const ms = Date.now() - new Date(lastAt).getTime();
    if (!Number.isFinite(ms) || ms < 0) return '';
    const days = Math.floor(ms / 86400000);
    if (days <= 0) return '今天';
    if (days < 30) return `${days} 天前`;
    return `${Math.floor(days / 30)} 个月前`;
  } catch { return ''; }
}

export default function ProfileInsightsSection({
  readingHistory = [],
  bookmarks = [],
  categories = [],
  profileLearningEngine,
  learnedPrefs,
}) {
  const theme = useThemeColors();
  const engine = profileLearningEngine || {};
  // label 展示映射在这里（而非 useIntelligenceMemos）完成：本组件是唯一需要
  // 「赛道中文名」的消费方，且映射依赖外部字典，放纯函数 withInterestLabels 可单测。
  // 修复：阅读趋势此前只吃 bookmarks，而书签默认 readAt=null → 趋势线永远没有数据。
  // 真正持续记录的是 readingHistory（每次阅读都带 readAt）——两者合并后才是完整的阅读画像。
  const reading = useMemo(() => {
    const historyRows = (readingHistory || []).map(item => ({
      ...item,
      readAt: item.readAt || item.firstReadAt || item.publishedAt || null,
    }));
    const bookmarkRows = (bookmarks || []).map(item => ({
      ...item,
      readAt: item.readAt || item.savedAt || item.createdAt || null,
    }));
    return withInterestLabels(
      computeReadingProfile([...historyRows, ...bookmarkRows]),
      categories,
    );
  }, [readingHistory, bookmarks, categories]);
  const ins = learnedPrefs?.insights || {};

  const hasData = readingHistory.length + bookmarks.length > 0;

  /* ---------- 提问模式 / 表达偏好 ---------- */
  const patterns = useMemo(() => (ins.patterns || []).map(p => ({
    label: PATTERN_LABELS[p.key] || p.key,
    count: p.count || 0,
  })), [ins.patterns]);
  const patternTotal = patterns.reduce((a, b) => a + b.count, 0);

  const prefs = useMemo(() => [
    ins.format && { label: '格式', selectedLabel: ins.format.label, count: ins.format.count || 0 },
    ins.depth && { label: '深度', selectedLabel: ins.depth.label, count: ins.depth.count || 0 },
    ins.length && { label: '长度', selectedLabel: ins.length.label, count: ins.length.count || 0 },
    ins.language && { label: '语言', selectedLabel: ins.language.label, count: ins.language.count || 0 },
  ].filter(Boolean), [ins]);

  /* ---------- 加权条数据 ---------- */
  const interestBars = useMemo(() => (reading.topInterests || []).slice(0, 6).map(i => ({
    label: i.label || i.id, count: i.count || 0,
  })), [reading]);

  const sourceBars = useMemo(() => (reading.topSources || []).slice(0, 6).map(s => ({
    label: s.name, count: s.count || 0,
  })), [reading]);

  const tagBars = useMemo(() => (engine.topTags || []).slice(0, 6).map(t => ({
    label: t.name, count: t.score || t.count || 0,
  })), [engine.topTags]);

  /* ---------- 最近关注实体 ---------- */
  const entities = useMemo(() => (ins.recentEntities || []).slice(0, 10), [ins.recentEntities]);

  /* ---------- 30 天趋势 ---------- */
  const trend = useMemo(() => ({
    labels: reading.day30?.map(d => d.slice(5)) || [],
    series: [{ name: '阅读', values: reading.trendData || [], color: theme.cyan }],
  }), [reading, theme.cyan]);

  const peak = hasData ? String(reading.peakHour).padStart(2, '0') : '--';
  const session = ins.sessionStats || {};

  const tele = [
    { label: '连续阅读', value: reading.streak, unit: '天', note: `日均 ${reading.avgDailyRead || 0} 条`, pct: Math.min(100, reading.streak * 7), tone: 'cyan' },
    { label: '峰值时段', value: peak, unit: ':00', note: '行为密度最高时段', pct: hasData ? ((reading.peakHour + 1) / 24) * 100 : 0, tone: 'green' },
    { label: '兴趣维度', value: interestBars.length, unit: '个', note: '按阅读行为聚合', pct: Math.min(100, interestBars.length * 17), tone: 'amber' },
    { label: '提问观测', value: patternTotal, unit: '次', note: `${patterns.length} 种模式`, pct: Math.min(100, patternTotal * 5), tone: 'violet' },
    { label: '记忆关键词', value: tagBars.length, unit: '个', note: `深度 ${engine.behaviorDepth || '—'}`, pct: Math.min(100, tagBars.length * 12), tone: 'blue' },
  ];

  return (
    <div className="profile-insights pa-atlas">
      {/* ============ 抬头：遥测带 ============ */}
      <header className="pa-header">
        <Brand
          kicker="INSIGHT DECK"
          title="行为洞察台"
          desc={`${engine.confidenceLabel || '待校准'} · ${engine.behaviorDepth || '探索校准型'}`}
          tags={patterns.slice(0, 2).map(p => p.label)}
        />
        <div className="pa-tele-grid">
          {tele.map(t => <Tele key={t.label} {...t} />)}
        </div>
      </header>

      {/* ============ 主栅格：趋势长图 + 右列（提问模式 / 表达偏好） ============ */}
      <div className="pa-grid pa-grid-main">
        <Panel
          kicker="READING TREND · 30D"
          title="阅读趋势"
          meta={hasData ? `峰值 ${peak}:00 · 连续 ${reading.streak} 天` : '等待数据'}
          className="pi-panel-trend"
        >
          {hasData ? (
            <HudLineChart labels={trend.labels} series={trend.series} height={210} area />
          ) : (
            <div className="pa-empty">收藏或阅读几条资讯，趋势线会在这里生长</div>
          )}
        </Panel>

        <div className="pa-col">
          <Panel kicker="QUERY PATTERNS" title="提问模式" meta={`${patternTotal} 次观测`}>
            <WeightedBars items={patterns} unit="次" emptyText="还没有对话观测" />
          </Panel>
          <Panel kicker="EXPRESSION PROFILE" title="表达偏好" meta="结论 + 硬度">
            <PreferenceMeters prefs={prefs} />
          </Panel>
        </div>
      </div>

      {/* ============ 第二行：兴趣 / 来源 / 关键词 三联条形 ============ */}
      <div className="pa-grid pa-grid-trio">
        <Panel kicker="INTEREST WEIGHT" title="兴趣分布" meta={`${interestBars.length} 个维度`}>
          <WeightedBars items={interestBars} emptyText="暂无阅读行为数据" />
        </Panel>
        <Panel kicker="FREQUENT SOURCES" title="高频来源" meta={`${sourceBars.length} 个信源`}>
          <WeightedBars items={sourceBars} emptyText="暂无来源数据" />
        </Panel>
        <Panel kicker="MEMORY KEYWORDS" title="记忆关键词" meta="按记忆权重">
          <WeightedBars items={tagBars} emptyText="暂无" />
        </Panel>
      </div>

      {/* ============ 第三行：最近关注实体 + 会话习惯 ============ */}
      <div className="pa-grid pa-grid-duo">
        <Panel kicker="RECENT FOCUS" title="最近关注实体" meta={`${entities.length} 个实体`}>
          {entities.length > 0 ? (
            <div className="pi-chips">
              {entities.map((e, i) => (
                <span key={`${e.entity}-${i}`} className="pi-chip" title={`观测 ${e.count || 1} 次${e.lastAt ? ` · 最近 ${relTime(e.lastAt)}` : ''}`}>
                  <b>{e.entity}</b>
                  <i>×{e.count || 1}</i>
                  {e.lastAt && <em>{relTime(e.lastAt)}</em>}
                </span>
              ))}
            </div>
          ) : (
            <div className="pa-empty">对话里提到的技术词会沉淀在这里</div>
          )}
        </Panel>

        <Panel kicker="SESSION HABITS" title="会话习惯" meta="此前从未被展示的一层">
          <SessionTiles stats={session} />
          <p className="pi-session-note">
            {session.totalSessions > 0
              ? `场均 ${session.avgRounds ?? 0} 轮追问，单场最多 ${session.maxRounds ?? 0} 轮——追问越深，画像学得越快。`
              : '还没有对话记录，去 AI 工作站聊一次就会开始积累。'}
          </p>
        </Panel>
      </div>
    </div>
  );
}
