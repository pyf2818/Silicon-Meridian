// skillLoader.js - P5 Skills 文件夹生态：轻量 SKILL.md 加载器
// 约定：项目根目录 skills/<source>/<skill-id>/SKILL.md
//   <source> ∈ { builtin, work, user }
//     - builtin: 随项目分发的官方技能
//     - work:    Agent 在工作中自动沉淀的技能
//     - user:    用户手动创建的技能
//
// SKILL.md 结构：YAML frontmatter + markdown body
//
// frontmatter 字段（全部可选，但建议填写）：
//   name:         技能唯一标识（kebab-case，缺省取目录名）
//   title:        展示名称
//   description:  一句话描述
//   category:     分类（如 research / writing / analysis / automation）
//   triggers:     触发关键词（逗号分隔，用于匹配用户输入）
//   tools:        依赖的工具列表（逗号分隔，对应 agentTools 的 tool name）
//   version:      语义化版本号
//   author:       作者
//
// body：markdown 格式的技能说明（prompt 模板 / 使用示例 / 注意事项）
//
// 设计原则：
//   1. 零依赖（不引入 yaml 库，用正则解析 frontmatter）
//   2. 健壮（单个 skill 解析失败不影响其他）
//   3. 缓存（启动时扫描一次，后续走内存；可通过 refresh() 重新扫描）

import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// skills/ 目录约定在项目根（server/ 的上一级）
const SKILLS_ROOT = process.env.SKILLS_ROOT || resolve(__dirname, '..', '..', 'skills');

// 三种来源：builtin 内置 / work 工作沉淀 / user 用户创建
export const SKILL_SOURCES = [
  { id: 'builtin', label: '内置', desc: '随项目分发的官方技能' },
  { id: 'work',    label: '工作沉淀', desc: 'Agent 在工作中自动沉淀的技能' },
  { id: 'user',    label: '用户创建', desc: '用户手动创建的技能' },
];

let cache = null;

/**
 * 简易 YAML frontmatter 解析：只支持 `key: value` 形式（值不支持嵌套）
 * 不引入 yaml 库，保持零依赖
 */
function parseFrontmatter(text) {
  const match = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(text);
  if (!match) return { meta: {}, body: text.trim() };
  const metaBlock = match[1];
  const body = match[2].trim();
  const meta = {};
  for (const line of metaBlock.split('\n')) {
    const m = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim();
    // 去除两端引号
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // 逗号分隔的列表 → 数组
    if (['triggers', 'tools', 'tags'].includes(key)) {
      value = value.split(',').map(s => s.trim()).filter(Boolean);
    }
    meta[key] = value;
  }
  return { meta, body };
}

/**
 * 读取单个 skill 目录
 */
function loadSkill(skillDir, id, source) {
  const skillMdPath = join(skillDir, 'SKILL.md');
  if (!existsSync(skillMdPath)) return null;
  try {
    const text = readFileSync(skillMdPath, 'utf-8');
    const { meta, body } = parseFrontmatter(text);
    return {
      id: meta.name || id,
      title: meta.title || meta.name || id,
      description: meta.description || '',
      category: meta.category || 'general',
      triggers: Array.isArray(meta.triggers) ? meta.triggers : [],
      tools: Array.isArray(meta.tools) ? meta.tools : [],
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      version: meta.version || '0.1.0',
      author: meta.author || '',
      source,
      body,
      path: skillMdPath,
    };
  } catch {
    return null;
  }
}

/**
 * 扫描单个 source 目录（如 skills/builtin/）
 */
function scanSourceDir(sourceDir, source) {
  const result = [];
  if (!existsSync(sourceDir)) return result;
  let entries;
  try {
    entries = readdirSync(sourceDir);
  } catch {
    return result;
  }
  for (const entry of entries) {
    // 跳过以 _ 或 . 开头的项（_README.md / _template/ / .gitignore 等）
    if (entry.startsWith('_') || entry.startsWith('.')) continue;
    const skillDir = join(sourceDir, entry);
    try {
      if (!statSync(skillDir).isDirectory()) continue;
    } catch { continue; }
    const skill = loadSkill(skillDir, entry, source);
    if (skill) result.push(skill);
  }
  return result;
}

/**
 * 扫描 skills/ 下三个子目录（builtin/work/user），返回所有 skill 列表
 * @param {boolean} [forceRefresh=false] 强制重新扫描
 * @returns {Array} skill 列表（每项含 source 字段）
 */
export function listSkills(forceRefresh = false) {
  if (cache && !forceRefresh) return cache;
  cache = [];
  for (const { id: source } of SKILL_SOURCES) {
    const sourceDir = join(SKILLS_ROOT, source);
    const skills = scanSourceDir(sourceDir, source);
    cache.push(...skills);
  }
  // 按 source 优先级（builtin > work > user）+ category + title 排序
  const sourceOrder = { builtin: 0, work: 1, user: 2 };
  cache.sort((a, b) => {
    const so = (sourceOrder[a.source] ?? 9) - (sourceOrder[b.source] ?? 9);
    if (so !== 0) return so;
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.title.localeCompare(b.title);
  });
  return cache;
}

/**
 * 按 id 获取单个 skill 详情
 */
export function getSkillById(id) {
  if (!id) return null;
  return listSkills().find(s => s.id === id) || null;
}

/**
 * 按 trigger 关键词匹配 skill（用于 agent 自动选择技能）
 * 返回所有 triggers 命中的 skill（按命中数降序）
 */
export function matchSkillsByTriggers(query) {
  if (!query) return [];
  const q = String(query).toLowerCase();
  return listSkills()
    .map(skill => {
      const hits = (skill.triggers || []).filter(t => q.includes(String(t).toLowerCase())).length;
      return { skill, hits };
    })
    .filter(x => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .map(x => x.skill);
}

/**
 * 按 source 分组返回（用于 UI 三栏展示）
 * @returns {{builtin: Array, work: Array, user: Array}}
 */
export function listSkillsBySource(forceRefresh = false) {
  const all = listSkills(forceRefresh);
  const grouped = { builtin: [], work: [], user: [] };
  for (const s of all) {
    if (!grouped[s.source]) grouped[s.source] = [];
    grouped[s.source].push(s);
  }
  return grouped;
}

/* =========================================================================
 * CRUD：保存 / 创建 / 删除（用于 SkillsPanel 编辑能力）
 * - 仅允许写 work / user 两个源；builtin 为只读
 * - 写入后自动 refresh() 让缓存与磁盘同步
 * ========================================================================= */

const WRITABLE_SOURCES = new Set(['work', 'user']);

/**
 * 校验 skill id（kebab-case，1-64 字符，禁止路径穿越）
 */
function isValidSkillId(id) {
  return typeof id === 'string'
    && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id)
    && !id.includes('..')
    && !id.includes('/');
}

/**
 * 把 skill 对象序列化为 SKILL.md 文本（YAML frontmatter + body）
 */
function serializeSkill(skill) {
  const meta = [];
  const pushMeta = (key, value) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      if (value.length === 0) return;
      meta.push(`${key}: ${value.join(', ')}`);
    } else {
      meta.push(`${key}: ${value}`);
    }
  };
  pushMeta('name', skill.id);
  pushMeta('title', skill.title);
  pushMeta('description', skill.description);
  pushMeta('category', skill.category || 'general');
  pushMeta('triggers', skill.triggers);
  pushMeta('tools', skill.tools);
  pushMeta('tags', skill.tags);
  pushMeta('version', skill.version || '0.1.0');
  pushMeta('author', skill.author);
  const body = (skill.body || '').trim();
  return `---\n${meta.join('\n')}\n---\n\n${body}\n`;
}

/**
 * 保存（更新或新建）一个 skill
 * @param {object} skill - 必须含 source/id；可选 title/description/category/triggers/tools/tags/version/author/body
 * @returns {object} 写入后的 skill 完整对象
 * @throws {Error} source 不允许写入 / id 非法 / 磁盘写入失败
 */
export function saveSkill(skill) {
  const source = skill?.source;
  const id = skill?.id;
  if (!WRITABLE_SOURCES.has(source)) {
    throw new Error(`source '${source}' 不允许写入（仅 work/user 可写）`);
  }
  if (!isValidSkillId(id)) {
    throw new Error(`skill id 非法：${id}（需 kebab-case，1-64 字符）`);
  }
  const skillDir = join(SKILLS_ROOT, source, id);
  const skillMdPath = join(skillDir, 'SKILL.md');
  try {
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(skillMdPath, serializeSkill(skill), 'utf-8');
  } catch (err) {
    throw new Error(`写入失败：${err?.message || err}`);
  }
  // 刷新缓存后返回最新数据
  refreshCache();
  return getSkillById(id);
}

/**
 * 保存原始 SKILL.md 文本（绕过 serializeSkill，直接写磁盘）
 * 用于 SkillsPanel 的"源码模式"编辑：用户可直接编辑 frontmatter + body
 * @param {string} source - work / user
 * @param {string} id - skill id
 * @param {string} rawText - 完整的 SKILL.md 文本（含 frontmatter）
 * @returns {object} 写入后的 skill 完整对象（重新解析得到）
 * @throws {Error} source 不允许写入 / id 非法 / 磁盘写入失败
 */
export function saveSkillRaw(source, id, rawText) {
  if (!WRITABLE_SOURCES.has(source)) {
    throw new Error(`source '${source}' 不允许写入（仅 work/user 可写）`);
  }
  if (!isValidSkillId(id)) {
    throw new Error(`skill id 非法：${id}（需 kebab-case，1-64 字符）`);
  }
  const skillDir = join(SKILLS_ROOT, source, id);
  const skillMdPath = join(skillDir, 'SKILL.md');
  try {
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(skillMdPath, String(rawText || ''), 'utf-8');
  } catch (err) {
    throw new Error(`写入失败：${err?.message || err}`);
  }
  refreshCache();
  return getSkillById(id);
}

/**
 * 创建新 skill（与 saveSkill 同语义，但会先检查 id 是否已存在）
 * @param {object} skill - 同 saveSkill
 * @returns {object} 创建后的 skill 完整对象
 * @throws {Error} 已存在 / source 不允许 / id 非法
 */
export function createSkill(skill) {
  const existing = getSkillById(skill?.id);
  if (existing) {
    throw new Error(`skill id '${skill.id}' 已存在（来源：${existing.source}）`);
  }
  return saveSkill(skill);
}

/**
 * 删除 skill（仅 work/user 可删；builtin 只读）
 * @param {string} id - skill id
 * @returns {{ok: boolean, source: string, path: string}}
 * @throws {Error} 不存在 / source 不可删
 */
export function deleteSkill(id) {
  const existing = getSkillById(id);
  if (!existing) {
    throw new Error(`skill id '${id}' 不存在`);
  }
  if (!WRITABLE_SOURCES.has(existing.source)) {
    throw new Error(`source '${existing.source}' 不允许删除（builtin 只读）`);
  }
  const skillDir = join(SKILLS_ROOT, existing.source, id);
  try {
    rmSync(skillDir, { recursive: true, force: true });
  } catch (err) {
    throw new Error(`删除失败：${err?.message || err}`);
  }
  refreshCache();
  return { ok: true, source: existing.source, path: skillDir };
}

/**
 * 强制刷新内存缓存（save/delete 后内部调用；也可供外部触发）
 */
function refreshCache() {
  cache = null;
  listSkills(true);
}

export { SKILLS_ROOT, isValidSkillId as _isValidSkillId };
