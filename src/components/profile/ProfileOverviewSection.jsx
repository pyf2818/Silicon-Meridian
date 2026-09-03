// src/components/profile/ProfileOverviewSection.jsx
// 画像总览 v3 —— 「认知星图 COGNITIVE ATLAS」
//
// 上一版是标准仪表盘：KPI 条 + 雷达 + 热力图 + 词云。问题不是丑，是**平**——
// 每个面板各说一句话，读的人需要自己在脑内把它们拼成一个"我"。
//
// 这一版换个组织原则：**一张主图承载结构，其余面板负责解释它**。
//   · 认知罗盘 = 「你是什么形状」（昼夜节律 / 领域力场 / 时间螺旋 / 置信核心 四层同构）
//   · 转化漏斗 = 信息被消化了多少（比"读了多少"更接近画像的本质）
//   · 气泡场   = 注意力被什么占据（面积可比，胜过字号）
//   · 溯源+频谱 = 系统凭什么这么判断（可核对，才敢信）
//   · 观测日志 = 盲区与下一步（把仪表盘变成行动界面）
import { useMemo } from 'react';
import { useProfileStore } from '../../store';
import { computeReadingProfile } from '../../utils/profileModel.js';
import { loadLearnedProfile } from '../../utils/profileLearning.js';
import { PROFILE_TIERS } from '../../domain/intelligence/profileTiers.js';
import { showToast } from '../../utils/toast.js';
import CognitiveCompass from './charts/CognitiveCompass.jsx';
import ConversionFunnel from './charts/ConversionFunnel.jsx';
import BubbleField from './charts/BubbleField.jsx';
import { ObservationLog, SourceTrust, SpectrumRow, TimeBand } from './charts/AtlasPanels.jsx';

/* 偏好频谱的刻度定义（与 profileLearning.js 的 LABELS 保持一致） */
const SPECTRUM_DEFS = [
  { label: '内容形式', field: 'preferredFormat', options: [['table', '表格'], ['list', '列表'], ['paragraph', '段落']] },
  { label: '阅读深度', field: 'preferredDepth', options: [['concise', '简洁'], ['standard', '标准'], ['deep', '深入']] },
  { label: '内容长度', field: 'preferredLength', options: [['short', '短'], ['medium', '中'], ['long', '长']] },
  { label: '语言偏好', field: 'preferredLanguage', options: [['zh', '中文'], ['en', '英文'], ['mixed', '中英混合']] },
];

function Tele({ label, value, unit, note, pct = 0, tone = '' }) {
  return (
    <div className={'pa-tele ' + tone}>
      <span className="pa-tele-label">{label}</span>
      <div className="pa-tele-value-row">
        <strong className="pa-tele-value">{value}</strong>
        {unit && <span className="pa-tele-unit">{unit}</span>}
      </div>
      <span className="pa-tele-note">{note}</span>
      <span className="pa-tele-track"><i style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} /></span>
    </div>
  );
}

function Panel({ kicker, title, meta, children, className = '' }) {
  return (
    <section className={'pa-panel ' + className}>
      <div className="pa-panel-head">
        <div className="pa-panel-titles">
          <span className="pa-kicker">{kicker}</span>
          <h2>{title}</h2>
        </div>
        {meta && <span className="pa-panel-meta">{meta}</span>}
      </div>
      <div className="pa-panel-body">{children}</div>
    </section>
  );
}

export default function ProfileOverviewSection({
  readingHistory = [],
  bookmarks = [],
  materials = [],
  selectedInterests = [],
  profileLearningEngine,
  learnedPrefs,
}) {
  const personaSummary = useProfileStore(state => state.personaSummary);

  const engine = profileLearningEngine || {};
  const confidence = engine.confidence ?? 0;
  const reading = useMemo(() => computeReadingProfile(bookmarks), [bookmarks]);

  /* 频谱需要完整分布（getLearnedPreferences 只返回 top1），这里直读原始观测 */
  const raw = useMemo(() => {
    try { return loadLearnedProfile(); } catch { return null; }
  }, []);

  const hasData = readingHistory.length + bookmarks.length + materials.length > 0;
  const total = readingHistory.length + bookmarks.length + materials.length;

  /* ---------- 遥测带 ---------- */
  const trend = reading.trendData || [];
  const last7 = trend.slice(-7).reduce((a, b) => a + b, 0);
  const prevAvg = trend.slice(0, 23).reduce((a, b) => a + b, 0) / 23;
  const weeklyDelta = prevAvg > 0.05 ? Math.round(((last7 / 7 - prevAvg) / prevAvg) * 100) : null;
  const peakHour = hasData ? String(reading.peakHour).padStart(2, '0') : '--';
  const conversion = readingHistory.length ? Math.round((materials.length / readingHistory.length) * 100) : 0;

  const tele = [
    { label: '行为样本', value: readingHistory.length, unit: '条', note: weeklyDelta == null ? '近 30 日累计' : `近 7 日 ${weeklyDelta >= 0 ? '+' : ''}${weeklyDelta}%`, pct: total ? (readingHistory.length / total) * 100 : 0, tone: 'cyan' },
    { label: '连续阅读', value: reading.streak, unit: '天', note: `活跃峰值 ${peakHour}:00`, pct: Math.min(100, reading.streak * 7), tone: 'green' },
    { label: '收藏沉淀', value: bookmarks.length, unit: '条', note: `收藏率 ${engine.savedRatio ?? 0}%`, pct: total ? (bookmarks.length / total) * 100 : 0, tone: 'amber' },
    { label: '素材转化', value: materials.length, unit: '份', note: `转化率 ${engine.materialRatio ?? 0}%`, pct: total ? (materials.length / total) * 100 : 0, tone: 'violet' },
    { label: '关注领域', value: selectedInterests.length, unit: '个', note: `覆盖 ${(engine.topCategories || []).length} 个高权域`, pct: Math.min(100, selectedInterests.length * 10), tone: 'blue' },
  ];

  /* ---------- 罗盘 ---------- */
  const domains = (engine.topCategories || []).slice(0, 8);

  /* ---------- 气泡场：行为标签 + 对话主题合并去重 ---------- */
  const bubbles = useMemo(() => {
    const merged = [
      ...(engine.topTags || []).map(t => ({ name: t.name, weight: t.score || 1 })),
      ...((learnedPrefs?.insights?.topics) || []).map(t => ({ name: t.key, weight: (t.count || 1) * 2 })),
    ];
    const seen = new Set();
    return merged
      .filter(b => b.name && !seen.has(String(b.name).toLowerCase()) && seen.add(String(b.name).toLowerCase()))
      .slice(0, 16);
  }, [engine.topTags, learnedPrefs]);

  /* ---------- 信号溯源 ---------- */
  const sources = useMemo(() => (engine.topSources || []).slice(0, 6).map(s => ({
    ...s,
    tierLabel: s.tier ? (PROFILE_TIERS[s.tier]?.shortLabel || '') : '',
  })), [engine.topSources]);

  /* ---------- 偏好频谱 ---------- */
  const spectrum = useMemo(() => SPECTRUM_DEFS.map(def => {
    const dist = (raw && raw[def.field]) || {};
    const insightKey = def.field === 'preferredFormat' ? 'format'
      : def.field === 'preferredDepth' ? 'depth'
        : def.field === 'preferredLength' ? 'length'
          : 'language';
    const picked = learnedPrefs?.insights?.[insightKey];
    return {
      label: def.label,
      selected: picked?.key || '',
      options: def.options.map(([key, label]) => ({ key, label })),
      counts: Object.fromEntries(def.options.map(([key]) => [key, Number(dist[key]) || 0])),
    };
  }).filter(row => Object.values(row.counts).some(v => v > 0)), [raw, learnedPrefs]);

  const timePref = useMemo(() => {
    const out = {};
    ((learnedPrefs?.insights?.time) || []).forEach(t => { out[t.key] = t.count; });
    return out;
  }, [learnedPrefs]);

  /* ---------- 观测日志 ---------- */
  const evidence = useMemo(() => {
    const parts = (engine.explanation || '').split('；').filter(Boolean);
    if (parts.length) return parts.slice(0, 5);
    const fallback = [];
    if (domains[0]) fallback.push(`领域权重最高：${domains[0].label}`);
    if (sources[0]) fallback.push(`信任来源最高：${sources[0].name}`);
    if (bubbles[0]) fallback.push(`记忆关键词：${bubbles.slice(0, 3).map(b => b.name).join('、')}`);
    return fallback;
  }, [engine.explanation, domains, sources, bubbles]);

  const personaTags = [...(personaSummary?.traits || []), ...(personaSummary?.habits || [])].slice(0, 6);

  const confLevel = confidence >= 75 ? 'high' : confidence >= 45 ? 'mid' : 'low';

  return (
    <div className="profile-overview pa-atlas" data-level={confLevel}>
      {/* ============ 观测抬头：一行遥测带 ============ */}
      <header className="pa-header">
        <div className="pa-header-brand">
          <span className="pa-kicker">COGNITIVE ATLAS</span>
          <h2>认知星图</h2>
          <p>
            {engine.behaviorDepth || '探索校准型'} · {engine.confidenceLabel || '待校准'}
            {personaTags.length > 0 && <em> / {personaTags.join(' / ')}</em>}
          </p>
        </div>
        <div className="pa-tele-grid">
          {tele.map(t => <Tele key={t.label} {...t} />)}
        </div>
      </header>

      {/* ============ 主栅格：罗盘 + 解释列 ============ */}
      <div className="pa-grid pa-grid-main">
        <Panel
          kicker="COGNITIVE COMPASS"
          title="认知罗盘"
          meta="外环·昼夜节律 / 中环·领域力场 / 内旋·30 天"
          className="pa-panel-compass"
        >
          <CognitiveCompass
            hourDist={reading.hourDist}
            trendData={trend}
            day30={reading.day30}
            domains={domains}
            confidence={confidence}
            confidenceLabel={engine.confidenceLabel}
            behaviorDepth={engine.behaviorDepth}
            empty={!hasData}
          />
          <div className="pa-compass-foot">
            <span>把鼠标移到环上，逐层读取你的时间形状</span>
            <span className="pa-compass-key">
              <i className="k-day" />昼夜
              <i className="k-domain" />领域
              <i className="k-time" />30 天
            </span>
          </div>
        </Panel>

        <div className="pa-col">
          <Panel kicker="SIGNAL PROVENANCE" title="信息从哪来" meta={`${sources.length} 个高信任源`}>
            <SourceTrust sources={sources} />
          </Panel>

          <Panel kicker="PREFERENCE SPECTRUM" title="系统怎么看你" meta="可核对">
            {spectrum.length
              ? spectrum.map(row => <SpectrumRow key={row.label} {...row} />)
              : <div className="pa-empty">对话样本不足，多和 AI 聊几句就会形成偏好判断</div>}
          </Panel>
        </div>
      </div>

      {/* ============ 第二行：漏斗 / 气泡 / 时段 ============ */}
      <div className="pa-grid pa-grid-trio">
        <Panel kicker="DIGESTION FUNNEL" title="信息消化漏斗" meta={`总转化 ${conversion}%`}>
          <ConversionFunnel
            stages={[
              { label: '浏览', value: readingHistory.length, note: '行为样本' },
              { label: '收藏', value: bookmarks.length, note: `${engine.savedRatio ?? 0}% 留存` },
              { label: '沉淀', value: materials.length, note: `${engine.materialRatio ?? 0}% 转化` },
            ]}
          />
        </Panel>

        <Panel kicker="ATTENTION FIELD" title="注意力占地" meta={`${bubbles.length} 个主题`}>
          <BubbleField items={bubbles} emptyText="阅读与对话后，这里会长出你的注意力地图" />
        </Panel>

        <Panel kicker="ACTIVE WINDOW" title="活跃时段" meta="24H">
          <TimeBand hourDist={reading.hourDist} timePref={timePref} />
          <div className="pa-timeband-foot">
            <span>柱高 = 阅读强度 · 亮标 = 对话偏好时段</span>
            <b>{peakHour}:00</b>
          </div>
        </Panel>
      </div>

      {/* ============ 观测日志 ============ */}
      <Panel kicker="OBSERVATION LOG" title="系统此刻的判断" meta={engine.confidenceLabel || '待校准'} className="pa-panel-log">
        <ObservationLog
          summary={engine.summary}
          evidence={evidence}
          blindSpots={engine.blindSpots || []}
          nextActions={engine.nextActions || []}
          onAction={action => showToast(action)}
          statusLabel={hasData ? 'LIVE' : 'STANDBY'}
        />
      </Panel>
    </div>
  );
}
