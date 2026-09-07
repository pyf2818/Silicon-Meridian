const finite = value => value !== null && value !== '' && Number.isFinite(Number(value));
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

function numericValues(bars, field, period) {
  return bars.slice(-period).map(bar => Number(bar?.[field])).filter(finite);
}

export function simpleMovingAverage(bars = [], period = 5) {
  const values = numericValues(bars, 'close', period);
  return values.length === period ? mean(values) : null;
}

export function annualizedVolatility(bars = [], periods = 252) {
  const closes = bars.map(bar => Number(bar?.close)).filter(value => finite(value) && value > 0);
  const returns = closes.slice(1).map((value, index) => Math.log(value / closes[index]));
  if (returns.length < 2) return null;
  const average = mean(returns);
  const variance = returns.reduce((sum, value) => sum + (value - average) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance * periods) * 100;
}

export function supportResistance(bars = [], lookback = 20) {
  const lows = numericValues(bars, 'low', lookback);
  const highs = numericValues(bars, 'high', lookback);
  return {
    support: lows.length ? Math.min(...lows) : null,
    resistance: highs.length ? Math.max(...highs) : null,
  };
}

export function volumeTrend(bars = [], period = 5) {
  const values = numericValues(bars, 'volume', period);
  if (values.length < 3) return 'insufficient';
  const midpoint = Math.floor(values.length / 2);
  const first = mean(values.slice(0, midpoint));
  const last = mean(values.slice(values.length - midpoint));
  if (last > first * 1.2) return 'expanding';
  if (last < first * 0.8) return 'contracting';
  return 'stable';
}

export function priceMomentum(bars = [], period = 5) {
  const closes = numericValues(bars, 'close', period + 1);
  if (closes.length < period + 1 || closes[0] <= 0) return null;
  return ((closes.at(-1) / closes[0]) - 1) * 100;
}

export function averageTrueRange(bars = [], period = 14) {
  if (bars.length < period + 1) return null;
  const ranges = bars.slice(-(period + 1)).map((bar, index, list) => {
    if (index === 0) return null;
    const high = Number(bar?.high);
    const low = Number(bar?.low);
    const previousClose = Number(list[index - 1]?.close);
    if (![high, low, previousClose].every(finite)) return null;
    return Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose));
  }).filter(finite);
  return ranges.length === period ? mean(ranges) : null;
}

export function maxDrawdown(bars = []) {
  const closes = bars.map(bar => Number(bar?.close)).filter(value => finite(value) && value > 0);
  if (closes.length < 2) return null;
  let peak = closes[0];
  let drawdown = 0;
  closes.forEach(close => {
    peak = Math.max(peak, close);
    drawdown = Math.min(drawdown, (close / peak - 1) * 100);
  });
  return Math.abs(drawdown);
}

export function pricePosition(bars = [], lookback = 20) {
  const closes = numericValues(bars, 'close', lookback);
  if (closes.length < lookback) return null;
  const low = Math.min(...closes);
  const high = Math.max(...closes);
  return high === low ? 50 : ((closes.at(-1) - low) / (high - low)) * 100;
}

export function relativePerformance(bars = [], benchmarkBars = [], period = 20) {
  const assetReturn = priceMomentum(bars, period);
  const benchmarkReturn = priceMomentum(benchmarkBars, period);
  if (assetReturn == null || benchmarkReturn == null) return null;
  return {
    assetReturn,
    benchmarkReturn,
    excessReturn: assetReturn - benchmarkReturn,
  };
}

/* ===== v24 #1：MACD / RSI / KDJ（大师级 AI 分析的技术面输入） ===== */

/** EMA（指数移动平均），返回与输入等长的序列（前 period-1 位为 null） */
export function emaSeries(values = [], period = 12) {
  const k = 2 / (period + 1);
  const out = [];
  let prev = null;
  values.forEach((value, i) => {
    if (!Number.isFinite(Number(value))) { out.push(null); return; }
    const v = Number(value);
    if (prev == null) {
      // 种子取前 period 个的 SMA（不足则取已有均值）
      const seed = values.slice(0, Math.min(period, i + 1)).map(Number).filter(Number.isFinite);
      prev = mean(seed);
    } else {
      prev = v * k + prev * (1 - k);
    }
    out.push(prev);
  });
  return out;
}

/**
 * MACD(12, 26, 9)：返回 { macd, signal, hist } 最新值（快慢线差值 → DEA → 柱）。
 * 数据不足返回 null 字段。
 */
export function macd(bars = [], fast = 12, slow = 26, signalPeriod = 9) {
  const closes = bars.map(bar => Number(bar?.close)).filter(finite);
  if (closes.length < slow + signalPeriod) return { macd: null, signal: null, hist: null };
  const emaFast = emaSeries(closes, fast);
  const emaSlow = emaSeries(closes, slow);
  const dif = closes.map((_, i) => (emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null));
  const difValid = dif.filter(v => v != null);
  const dea = emaSeries(difValid, signalPeriod);
  const macdLine = difValid[difValid.length - 1];
  const signalLine = dea[dea.length - 1];
  return {
    macd: macdLine != null ? round2(macdLine) : null,
    signal: signalLine != null ? round2(signalLine) : null,
    hist: macdLine != null && signalLine != null ? round2((macdLine - signalLine) * 2) : null,
  };
}

/** RSI(N)：默认 14；数据不足返回 null */
export function rsi(bars = [], period = 14) {
  const closes = bars.map(bar => Number(bar?.close)).filter(finite);
  if (closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gain += diff; else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  // Wilder 平滑补全剩余样本
  for (let i = period + 1; i < closes.length; i += 1) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return round2(100 - 100 / (1 + rs));
}

/** KDJ(9, 3, 3)：返回 { k, d, j } 最新值；数据不足返回 null 字段 */
export function kdj(bars = [], period = 9, kSmooth = 3, dSmooth = 3) {
  const rows = bars.map(bar => ({
    high: Number(bar?.high), low: Number(bar?.low), close: Number(bar?.close),
  })).filter(row => [row.high, row.low, row.close].every(Number.isFinite));
  if (rows.length < period) return { k: null, d: null, j: null };
  let k = 50;
  let d = 50;
  for (let i = period - 1; i < rows.length; i += 1) {
    const window = rows.slice(i - period + 1, i + 1);
    const hh = Math.max(...window.map(r => r.high));
    const ll = Math.min(...window.map(r => r.low));
    const rsv = hh === ll ? 50 : ((rows[i].close - ll) / (hh - ll)) * 100;
    k = (rsv + (kSmooth - 1) * k) / kSmooth;
    d = (k + (dSmooth - 1) * d) / dSmooth;
  }
  const j = 3 * k - 2 * d;
  return { k: round2(k), d: round2(d), j: round2(j) };
}

function round2(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}
