/**
 * 信源动态表现统计（P4）—— 让「源等级」从静态标注长出动态修正。
 *
 * 背景：对抗性审查发现源等级是**静态手工标注**：S 级源被收购/降质系统无感知，
 * D 级源持续产出独家也升不了级。本模块用三个持续累积的计数器给出「动态表现分」：
 *   - topHits        进入可见集合（TOP-500）的条目数 —— 内容被展示认可的频次
 *   - blockedHits    被用户屏蔽词过滤的条目数 —— 用户用脚投票的反向信号
 *   - corroborations 产出过交叉验证（独立源 ≥2）的条目数 —— 内容可信度的正向信号
 *
 * 动态分公式：样本 ≥ MIN_SAMPLES 时 dynamicScore = topHits / (topHits + blockedHits)；
 * 样本不足返回 **null**（= 不修正，只用静态等级）—— 宁可保守，不拿 3 个样本给源定性。
 *
 * 持久化：JSON 文件（`.data/source-stats.json`，已 gitignore），防抖 5s 写盘，进程重启不丢。
 * 数据库方案（三表/迁移）留待数据量证明必要后再上 —— 先用最小成本把「动态」跑起来。
 */
import fs from 'node:fs';
import path from 'node:path';
import { clamp01 } from './halfLife.js';

const DEFAULT_STORE_PATH = path.resolve(process.cwd(), '.data/source-stats.json');

/** 动态分生效所需的最小样本量（命中 + 屏蔽） */
export const MIN_SAMPLES_FOR_DYNAMIC = 10;

let storePath = DEFAULT_STORE_PATH;
let cache = null;
let saveTimer = null;

function loadStore() {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    cache = parsed && typeof parsed === 'object' && parsed.sources ? parsed : { version: 1, sources: {} };
  } catch {
    cache = { version: 1, sources: {} };
  }
  if (!cache.sources || typeof cache.sources !== 'object') cache.sources = {};
  return cache;
}

function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flushSourceStats();
  }, 5_000);
}

/** 立即写盘（防抖的同步出口；测试与优雅退出用） */
export function flushSourceStats() {
  try {
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, JSON.stringify(loadStore()));
  } catch {
    // 统计写盘失败不影响主流程：动态分只是锦上添花
  }
}

/** 测试专用：切换存储文件（切换即重置内存缓存） */
export function setSourceStatsStorePath(nextPath) {
  storePath = nextPath;
  cache = null;
}

/** 测试专用：清空内存态 */
export function resetSourceStatsForTests() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  cache = null;
}

function bump(source, field) {
  const name = String(source || '').trim();
  if (!name) return;
  const store = loadStore();
  const entry = store.sources[name] || (store.sources[name] = { topHits: 0, blockedHits: 0, corroborations: 0, updatedAt: 0 });
  entry[field] += 1;
  entry.updatedAt = Date.now();
  saveSoon();
}

/** 这些来源的条目进入了可见集合 */
export function recordTopHits(sources = []) {
  for (const source of sources) bump(source, 'topHits');
}

/** 这些来源的条目被用户屏蔽词过滤 */
export function recordBlockedHits(sources = []) {
  for (const source of sources) bump(source, 'blockedHits');
}

/** 这些来源的条目获得了交叉验证（独立源 ≥2） */
export function recordCorroborations(entries = []) {
  for (const { source } of entries) bump(source, 'corroborations');
}

/**
 * 某来源的动态表现分。
 * @returns {number|null} 0..1；样本不足返回 null（调用方应只用静态等级）
 */
export function getDynamicSourceScore(source) {
  const entry = loadStore().sources[String(source || '').trim()];
  if (!entry) return null;
  const total = entry.topHits + entry.blockedHits;
  if (total < MIN_SAMPLES_FOR_DYNAMIC) return null;
  return clamp01(entry.topHits / total);
}

/** 报表用：全量快照（含样本量，便于展示「哪些源已有足够数据」） */
export function getSourceStatsSnapshot() {
  return JSON.parse(JSON.stringify(loadStore()));
}
