/**
 * 技能导入器（v38）：把社区/本地技能包安装到 skills/user/<name>/。
 *
 * 两个来源：
 *   1. installFromFiles(entries, nameHint)  —— zip 解压产物（server/skills/zipReader.js）
 *   2. installFromGitHub(repo, subpath, ref) —— GitHub contents API 递归拉取子目录
 *
 * 安全模型（导入内容按不可信数据对待）：
 *   - 只写 skills/user/（用户主动行为）；同名技能拒绝覆盖
 *   - SKILL.md 必须存在；id 从 frontmatter.name 或目录名 slug 化（kebab-case 强制）
 *   - 文件数/总大小上限与 zipReader 一致；路径已在 zipReader/install 层双重校验
 *   - 导入的 scripts/ 原样落盘但**永不自动执行**——agent 执行前必须经 read_skill_file
 *     审查内容 + execute_command 审批闸门
 *   - GitHub 仅允许 api.github.com / raw.githubusercontent.com（HTTPS），服务端发起（无 SSRF 面）
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { parseFrontmatter, listSkills, refreshSkills, SKILLS_ROOT } from './skillLoader.js';

const MAX_FILES = 200;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const GITHUB_API = 'https://api.github.com';
const RAW_HOST = 'raw.githubusercontent.com';

function importError(message) {
  return Object.assign(new Error(message), { code: 'SKILL_IMPORT_FAILED' });
}

/** 标准 Agent Skills name（kebab-case ≤64）→ 本仓 skill id；不合法时 slug 化，全空则报错 */
function toSafeId(raw) {
  const trimmed = String(raw || '').trim().toLowerCase();
  if (/^[a-z0-9][a-z0-9-]{0,63}$/.test(trimmed)) return trimmed;
  const slug = trimmed.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  if (!slug) throw importError(`技能名 "${raw}" 无法转换为合法 id（需 kebab-case）`);
  return slug;
}

/**
 * 把 {path: Buffer} 形态的文件映射安装为用户技能。
 * @param {Array<{path:string, data:Buffer}>} entries 已过路径安全校验的文件列表
 * @param {string} nameHint 技能名提示（zip 子目录名 / GitHub subpath 尾段）
 * @returns {{ id: string, files: number }} 写入结果
 */
export function installFromFiles(entries, nameHint = '') {
  if (!Array.isArray(entries) || entries.length === 0) throw importError('没有可安装的文件');
  if (entries.length > MAX_FILES) throw importError(`文件数 ${entries.length} 超过上限 ${MAX_FILES}`);
  let total = 0;
  for (const e of entries) total += e.data.length;
  if (total > MAX_TOTAL_BYTES) throw importError(`文件总量超过 ${MAX_TOTAL_BYTES / 1024 / 1024}MB 上限`);

  // 支持「根级 SKILL.md」与「单层目录包裹 my-skill/SKILL.md」两种 zip 形态
  let prefix = '';
  let skillMd = entries.find(e => e.path === 'SKILL.md');
  if (!skillMd) {
    const nested = entries.filter(e => e.path.endsWith('/SKILL.md'));
    // 多个 SKILL.md = 打包的是技能集合而非单技能 → 要求用户先指明子路径
    if (nested.length === 0) throw importError('zip 中未找到 SKILL.md（不是有效的技能包）');
    if (nested.length > 1) {
      throw importError(`zip 内含 ${nested.length} 个 SKILL.md（这是技能集合包），请单独下载其中一个技能目录再导入`);
    }
    skillMd = nested[0];
    prefix = skillMd.path.slice(0, skillMd.path.indexOf('/') + 1);
  }

  // frontmatter name 优先，其次目录名提示
  const { meta } = parseFrontmatter(skillMd.data.toString('utf-8'));
  const id = toSafeId(meta.name || nameHint || prefix.replace('/', '') || 'imported-skill');

  const existing = listSkills().find(s => s.id === id);
  if (existing) throw importError(`技能 id "${id}" 已存在（来源：${existing.source}），请先删除或改名`);

  const destRoot = join(SKILLS_ROOT, 'user', id);
  mkdirSync(destRoot, { recursive: true });
  let written = 0;
  for (const e of entries) {
    if (prefix && !e.path.startsWith(prefix)) continue; // 集合包里非本技能文件不落盘
    const rel = prefix ? e.path.slice(prefix.length) : e.path;
    if (!rel) continue;
    const dest = join(destRoot, ...rel.split('/'));
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, e.data);
    written += 1;
  }

  refreshSkills();
  return { id, files: written };
}

/* ============================ GitHub 来源 ============================ */

function ghHeaders() {
  return {
    'User-Agent': 'Silicon-Meridian-Skill-Importer',
    Accept: 'application/vnd.github+json',
  };
}

async function ghJson(url) {
  const resp = await fetch(url, { headers: ghHeaders() });
  if (resp.status === 403 || resp.status === 429) {
    const remaining = resp.headers.get('x-ratelimit-remaining');
    throw importError(`GitHub API 限流（remaining=${remaining}）。GitHub 免认证限额 60 次/小时，稍后再试或改用 zip 导入`);
  }
  if (resp.status === 404) throw importError(`GitHub 路径不存在：${url}`);
  if (!resp.ok) throw importError(`GitHub API ${resp.status}`);
  return resp.json();
}

async function ghRaw(url, maxBytes = 2 * 1024 * 1024) {
  const resp = await fetch(url, { headers: ghHeaders() });
  if (!resp.ok) throw importError(`GitHub raw 下载失败 ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.length > maxBytes) throw importError('GitHub 文件超过 2MB 上限');
  return buf;
}

/** 校验 "owner/repo" 形态（也可从完整 URL 提取） */
export function parseRepoInput(input) {
  let s = String(input || '').trim();
  if (!s) throw importError('repo 不能为空');
  // 完整 URL：https://github.com/owner/repo/tree/branch/sub/path
  const urlMatch = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?(?:\/tree\/([^/\s]+)((?:\/[^\s]+)?))?$/.exec(s);
  if (urlMatch) {
    return { repo: `${urlMatch[1]}/${urlMatch[2]}`, ref: urlMatch[3] || '', subpath: (urlMatch[4] || '').replace(/^\/+/, '') };
  }
  const m = /^([\w.-]+)\/([\w.-]+)$/.exec(s);
  if (!m) throw importError(`repo 形态不合法：${s}（应为 owner/repo 或完整 github URL）`);
  return { repo: s, ref: '', subpath: '' };
}

/** 递归拉取 GitHub 目录下全部文件（contents API；>1MB 文件走 raw 下载） */
async function fetchGithubDir(repo, subpath, ref, out, depth = 0) {
  if (out.length > MAX_FILES) throw importError(`文件数超过上限 ${MAX_FILES}`);
  if (depth > 8) throw importError('目录嵌套超过 8 层，放弃');
  const url = `${GITHUB_API}/repos/${repo}/contents/${encodeURI(subpath)}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`;
  const items = await ghJson(url);
  if (!Array.isArray(items)) throw importError('GitHub 返回的不是目录（可能指向了单个文件）');
  for (const item of items) {
    if (item.type === 'dir') {
      await fetchGithubDir(repo, item.path, ref, out, depth + 1);
    } else if (item.type === 'file') {
      if (out.length >= MAX_FILES) break;
      if (item.size > 2 * 1024 * 1024) throw importError(`文件 ${item.path} 超过 2MB 上限`);
      if (item.content) {
        // contents API base64（≤1MB）
        out.push({ path: item.path, data: Buffer.from(item.content, 'base64') });
      } else {
        // >1MB：contents API 不带 content，走 download_url（仅允许 raw.githubusercontent.com）
        const dl = String(item.download_url || '');
        if (!dl.startsWith(`https://${RAW_HOST}/`)) throw importError(`文件 ${item.path} 的下载地址不在白名单内`);
        out.push({ path: item.path, data: await ghRaw(dl) });
      }
    }
  }
}

/**
 * 从 GitHub 仓库子目录安装技能。
 * @param {string} repoInput owner/repo 或完整 github URL（可含 /tree/branch/subpath）
 * @param {string} [subpathOverride] 显式子路径（优先于 URL 内的）
 * @param {string} [refOverride] 显式分支/tag
 */
export async function installFromGitHub(repoInput, subpathOverride = '', refOverride = '') {
  const { repo, ref, subpath } = parseRepoInput(repoInput);
  const useSubpath = String(subpathOverride || subpath || '').replace(/^\/+|\/+$/g, '');
  const useRef = String(refOverride || ref || '');

  const entries = [];
  await fetchGithubDir(repo, useSubpath, useRef, entries);
  if (entries.length === 0) throw importError('GitHub 目录为空');

  // 相对化前缀（GitHub 返回 item.path 是 repo 内全路径）
  const prefix = useSubpath ? `${useSubpath}/` : '';
  const relEntries = entries.map(e => ({
    path: e.path.startsWith(prefix) ? e.path.slice(prefix.length) : e.path.split('/').pop(),
    data: e.data,
  }));

  const nameHint = useSubpath ? useSubpath.split('/').pop() : repo.split('/').pop();
  return installFromFiles(relEntries, nameHint);
}
