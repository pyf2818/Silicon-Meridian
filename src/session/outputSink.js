/**
 * outputSink.js - 工具长输出落盘（对标 pi 的 bash 输出写 temp 文件并提示路径）
 *
 * 现有工具结果在 agent loop 里被 `String(result).slice(0, 20000)` 截断后丢弃，
 * 超长产物（网页正文、K线批量、工作流输出）无法追溯。本模块：
 *   - 当结果超过 maxBytes 时，把它完整写入工作空间（workspace 的 rootHandle）
 *   - 返回「截断摘要 + 完整文件路径」，供 agent loop 追加到 tool 消息提示 LLM
 *   - 无工作空间（未授权 / FileSystemAccess 不支持）时退回原有截断行为
 * 纯逻辑：写入是 async，但构造提示文本是纯函数，可单测。
 */

import { writeFile } from '../utils/workspace.js';

/** 默认截断上限：与 aiHandlers 的 cleanText 保持一致 */
export const DEFAULT_MAX_BYTES = 20_000;

/**
 * 对一次工具结果做「截断 + 落盘」。
 * @param {Object} opts
 * @param {string} opts.toolName  - 工具名
 * @param {string} opts.result     - 原始文本结果
 * @param {string} [opts.pathHint] - 期望落盘相对路径（默认 auto: outputs/)
 * @param {Object} [opts.rootHandle] - FileSystemDirectoryHandle（无则不落盘）
 * @param {number} [opts.maxBytes]
 * @param {number} [opts.sessionId]
 * @returns {Promise<{text:string, truncated:boolean, saved?:string}>}
 *   - text: 给 LLM/UI 的结果文本（可能含「完整输出已保存到 …」提示）
 *   - truncated: 是否超出阈值发生了截断
 *   - saved: 落盘相对路径（未落盘为 undefined）
 */
export async function persistLongResult({ result, rootHandle, maxBytes = DEFAULT_MAX_BYTES, pathHint = '' }) {
  const text = String(result ?? '');
  const truncated = text.length > maxBytes;
  if (!truncated) {
    return { text, truncated, saved: undefined };
  }

  // head 预算内预留尾部提示空间（~120 字符），确保下游 clean 后提示仍可见
  const reserved = 140;
  const headLen = Math.max(120, maxBytes - reserved);
  const head = text.slice(0, headLen);
  const tailNote = `\n\n[完整输出过长（${text.length} 字符），已截断显示前 ${headLen} 字符。`;

  if (!rootHandle) {
    // 无工作空间：保留原有截断行为（不改动现网行为）
    return { text: `${head}${tailNote}点击「工作空间」授权后可自动保存完整输出]`, truncated, saved: undefined };
  }

  // 有工作空间：落盘完整输出
  const relative = safeRelativePath(pathHint || toolOutputPath());
  try {
    const saved = await writeFile(rootHandle, relative.segments, relative.fileName, text);
    return {
      text: `${head}${tailNote}完整输出已保存到 ${saved}]`,
      truncated,
      saved,
    };
  } catch {
    // 落盘失败：退回截断（不阻断 agent loop）
    return { text: `${head}${tailNote}保存失败（工作区不可写）]`, truncated, saved: undefined };
  }
}

/** 默认落盘目录：outputs/agent-tools/YYYY-MM-DD/时间戳-工具.md */
function toolOutputPath() {
  const d = new Date();
  const ymd = d.toISOString().slice(0, 10);
  const stamp = `${d.getHours().toString().padStart(2, '0')}${d.getMinutes().toString().padStart(2, '0')}${d.getSeconds().toString().padStart(2, '0')}`;
  return `outputs/agent-tools/${ymd}/${stamp}.md`;
}

function safeRelativePath(p) {
  const clean = String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = clean.split('/').filter(Boolean);
  const fileName = parts.pop() || 'tool-output.md';
  return { segments: parts, fileName };
}

/** 纯函数：把 tool result 追加地址提示后返回（供 agent loop 用，便于单测） */
export function withSavedPointer(text, relativePath) {
  return `${text}\n\n[完整输出已保存到：${relativePath}]`;
}