import React, { useMemo } from 'react';

/**
 * ProCharts - 专业模式诊断图表区
 * 只用确定性算法数据（K 线序列 + 诊断指标）绘制，不虚构：
 *  ① 价格 vs MA20 走势（近 60 根）＋支撑/压力参考线
 *  ② 多空证据强度对比
 *  ③ 20 期收益 vs 基准 + 关键风险位
 * 颜色走全局 --chart-* 语义令牌（跨调色板固定），深浅模式自动适配。
 */

const CHART_W = 560;
const CHART_H = 190;
const PAD = { top: 14, right: 44, bottom: 20, left: 8 };

function movingAverage(values, window) {
  return values.map((_, i) => {
    if (i < window - 1) return null;
    let sum = 0;
    for (let k = i - window + 1; k <= i; k += 1) sum += values[k];
    return sum / window;
  });
}

function PriceTrendChart({ klines = [], support, resistance }) {
  const view = useMemo(() => {
    const rows = (klines || []).filter(k => Number.isFinite(k?.close)).slice(-60);
    if (rows.length < 5) return null;
    const closes = rows.map(k => k.close);
    const ma20 = movingAverage(closes, 20);
    const innerW = CHART_W - PAD.left - PAD.right;
    const innerH = CHART_H - PAD.top - PAD.bottom;
    const levels = [...closes, ...(Number.isFinite(support) ? [support] : []), ...(Number.isFinite(resistance) ? [resistance] : [])];
    const min = Math.min(...levels);
    const max = Math.max(...levels);
    const span = max - min || 1;
    const x = i => PAD.left + (innerW * i) / (rows.length - 1);
    const y = v => PAD.top + innerH - ((v - min) / span) * innerH;
    const linePath = points => points
      .map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
      .filter(Boolean)
      .join(' ');
    const areaPath = `M ${x(0).toFixed(1)},${(PAD.top + innerH).toFixed(1)} L ${closes.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' L ')} L ${x(closes.length - 1).toFixed(1)},${(PAD.top + innerH).toFixed(1)} Z`;
    return { rows, ma20, min, max, x, y, linePath, areaPath, closes };
  }, [klines, support, resistance]);

  if (!view) return <p className="pro-chart-empty">K 线数据不足，暂无法绘制走势图。</p>;
  const { rows, ma20, min, max, x, y, linePath, areaPath, closes } = view;
  const last = closes[closes.length - 1];
  const up = rows.length > 1 && last >= rows[0].close;

  return (
    <div className="pro-chart-block">
      <div className="pro-chart-head">
        <strong>价格走势 · 近 {rows.length} 期</strong>
        <span>现价 <b>{last?.toFixed?.(2) ?? '--'}</b>{Number.isFinite(support) && <> · 支撑 <b>{support}</b></>}{Number.isFinite(resistance) && <> · 压力 <b>{resistance}</b></>}</span>
      </div>
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="pro-chart-svg" style={{ color: up ? 'var(--signal-critical)' : 'var(--signal-positive)' }} role="img" aria-label="价格与 MA20 走势图">
        <defs>
          <linearGradient id="proTrendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {/* 横向刻度线 */}
        {[0.25, 0.5, 0.75].map(ratio => {
          const gy = PAD.top + (CHART_H - PAD.top - PAD.bottom) * ratio;
          return <line key={ratio} x1={PAD.left} x2={CHART_W - PAD.right} y1={gy} y2={gy} className="pro-chart-grid" />;
        })}
        {/* 支撑/压力参考线 */}
        {Number.isFinite(resistance) && (
          <g>
            <line x1={PAD.left} x2={CHART_W - PAD.right} y1={y(resistance)} y2={y(resistance)} className="pro-chart-level" strokeDasharray="5 4" />
            <text x={CHART_W - PAD.right + 4} y={y(resistance) + 3} className="pro-chart-label">压力 {resistance}</text>
          </g>
        )}
        {Number.isFinite(support) && (
          <g>
            <line x1={PAD.left} x2={CHART_W - PAD.right} y1={y(support)} y2={y(support)} className="pro-chart-level" strokeDasharray="5 4" />
            <text x={CHART_W - PAD.right + 4} y={y(support) + 3} className="pro-chart-label">支撑 {support}</text>
          </g>
        )}
        <path d={areaPath} fill="url(#proTrendFill)" />
        <polyline points={linePath(closes)} fill="none" style={{ stroke: 'currentColor' }} strokeWidth="1.8" strokeLinejoin="round" />
        <polyline points={linePath(ma20)} fill="none" style={{ stroke: 'var(--chart-2)' }} strokeWidth="1.2" strokeDasharray="3 3" strokeLinejoin="round" />
        <text x={CHART_W - PAD.right + 4} y={PAD.top + 8} className="pro-chart-label">{max.toFixed(1)}</text>
        <text x={CHART_W - PAD.right + 4} y={CHART_H - PAD.bottom} className="pro-chart-label">{min.toFixed(1)}</text>
      </svg>
      <div className="pro-chart-legend">
        <span><i style={{ background: up ? 'var(--signal-critical)' : 'var(--signal-positive)' }} />价格（{up ? '区间上行' : '区间下行'}）</span>
        <span><i style={{ background: 'var(--chart-2)' }} />MA20</span>
      </div>
    </div>
  );
}

function EvidenceStrengthChart({ diagnosis }) {
  const bull = (diagnosis?.bullCase || []).length;
  const bear = (diagnosis?.bearCase || []).length;
  const total = bull + bear;
  if (!total) return null;
  const bullPct = Math.round((bull / total) * 100);
  return (
    <div className="pro-chart-block">
      <div className="pro-chart-head"><strong>多空证据强度</strong><span>基于算法证据清单（条数占比）</span></div>
      <div className="pro-evidence-track">
        <span className="pro-evidence-seg bull" style={{ width: `${bullPct}%` }} />
        <span className="pro-evidence-seg bear" style={{ width: `${100 - bullPct}%` }} />
      </div>
      <div className="pro-evidence-legend">
        <span><i className="bull" />多方 {bull} 条（{bullPct}%）</span>
        <span><i className="bear" />反方 {bear} 条（{100 - bullPct}%）</span>
      </div>
      <small className="pro-chart-note">条数占比 ≠ 概率；证据质量请结合失效条件人工复核。</small>
    </div>
  );
}

function BenchmarkChart({ metrics = {} }) {
  const asset = Number(metrics.assetReturn20);
  const bench = Number(metrics.benchmarkReturn20);
  const excess = Number(metrics.excessReturn20);
  if (![asset, bench].every(Number.isFinite)) {
    return (
      <div className="pro-chart-block">
        <div className="pro-chart-head"><strong>20 期表现对比</strong></div>
        <p className="pro-chart-empty">缺少基准数据，暂无法对比。</p>
      </div>
    );
  }
  const maxAbs = Math.max(Math.abs(asset), Math.abs(bench), 0.01);
  const bar = v => `${Math.max(4, (Math.abs(v) / maxAbs) * 50)}%`;
  return (
    <div className="pro-chart-block">
      <div className="pro-chart-head"><strong>20 期表现对比</strong><span>相对基准 {Number.isFinite(excess) ? `${excess >= 0 ? '+' : ''}${excess}%` : '--'}</span></div>
      <div className="pro-bench-rows">
        <div className="pro-bench-row">
          <span>本标的</span>
          <div className="pro-bench-track"><i className={asset >= 0 ? 'up' : 'down'} style={{ width: bar(asset) }} /></div>
          <b className={asset >= 0 ? 'up' : 'down'}>{asset >= 0 ? '+' : ''}{asset}%</b>
        </div>
        <div className="pro-bench-row">
          <span>基准</span>
          <div className="pro-bench-track"><i className={bench >= 0 ? 'up' : 'down'} style={{ width: bar(bench) }} /></div>
          <b className={bench >= 0 ? 'up' : 'down'}>{bench >= 0 ? '+' : ''}{bench}%</b>
        </div>
      </div>
      <small className="pro-chart-note">波动率 {metrics.volatility ?? '--'}% · 20 期位置 {metrics.position20 ?? '--'}% · 量能 {({ expanding: '放大', contracting: '收缩', stable: '平稳' })[metrics.volumeTrend] || '--'}</small>
    </div>
  );
}

export default function ProCharts({ klines = [], diagnosis }) {
  if (!diagnosis || diagnosis.status !== 'ready') return null;
  const m = diagnosis.metrics || {};
  return (
    <div className="pro-charts">
      <div className="pro-charts-title">专业图表</div>
      <PriceTrendChart klines={klines} support={m.support} resistance={m.resistance} />
      <div className="pro-charts-grid">
        <EvidenceStrengthChart diagnosis={diagnosis} />
        <BenchmarkChart metrics={m} />
      </div>
    </div>
  );
}
