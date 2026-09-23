// 附件注入（AI 工作站）：把用户上传的附件组装进 user 消息内容
//
// 设计要点（第一性）：
// - 附件文件本体经 /api/community/uploads 上传，消息里只存 URL + 元数据（防止 base64 撑爆 localStorage 持久化）
// - 文本类附件把内容（截断）直接注入 user content —— 任何模型都能真实读到，不依赖 vision 能力
// - 图片/视频注入 URL 与说明（界面已渲染缩略图/预览；vision 模型可结合 URL 理解，文本模型至少知道附件存在）
// - UI 显示与 LLM 输入分离：userMessage.content = 注入后全文（进历史/发给模型），
//   userMessage.displayContent = 用户原始输入（气泡展示用）

/** 文本注入单文件上限（字符）：服务端 user 消息清洗上限 64k，多文件合计需留余量 */
export const ATTACHMENT_TEXT_INJECT_LIMIT = 12_000;
/** 单条消息附件注入总预算（字符） */
export const ATTACHMENT_TEXT_TOTAL_LIMIT = 36_000;

/** 前端按扩展名/mime 粗判「可按文本读出内容」的附件（与服务端 FILE_MIMES 呼应，宽松即可） */
const TEXT_EXT_RE = /\.(txt|md|markdown|csv|tsv|json|log|xml|yml|yaml|ini|conf|env|js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|c|h|cpp|hpp|cs|php|sql|sh|bat|ps1|html|htm|css|scss|less|vue|svelte|toml|gitignore)$/i;
const TEXT_MIME_RE = /^(text\/|application\/(json|xml|javascript|x-yaml|sql))/i;

export function isTextLikeUpload(name = '', mime = '') {
  if (TEXT_MIME_RE.test(String(mime || ''))) return true;
  return TEXT_EXT_RE.test(String(name || ''));
}

/** 二进制嗅探：按文本读出的内容里出现 NUL 字符即视为二进制（放弃注入） */
export function looksBinary(text = '') {
  const sample = String(text).slice(0, 8000);
  return sample.includes('\u0000');
}

/**
 * 工作空间关联文件（v36.2）：source='workspace' 的本地文件，无上传 URL，
 * 靠 textContent 送达——与上传附件走同一条注入管道。
 */
export function isWorkspaceAttachment(att) {
  return att?.source === 'workspace'
    && typeof att?.textContent === 'string'
    && att.textContent.trim().length > 0;
}

/** 字节数友好化（与 UI 显示同口径） */
export function formatBytes(n) {
  const v = Number(n) || 0;
  if (v >= 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)}MB`;
  if (v >= 1024) return `${(v / 1024).toFixed(1)}KB`;
  return `${v}B`;
}

/**
 * 组装单个附件的注入块。
 * @param {object} att 上传完成的附件（{ name, mime, size, kind, url, textContent? }）
 * @param {number} remainBudget 剩余文本预算（字符）
 */
export function buildAttachmentBlock(att, remainBudget = ATTACHMENT_TEXT_TOTAL_LIMIT) {
  const isWs = isWorkspaceAttachment(att);
  const head = isWs
    ? `【空间文件】${att.name || '未命名'}（本地工作空间文件 · ${formatBytes(att.size)}）`
    : `【附件】${att.name || '未命名'}（${att.mime || att.kind || 'file'} · ${formatBytes(att.size)}）`;
  const tail = isWs
    ? `（本地工作空间文件：${att.path || att.name}）`
    : `（文件已上传：${att.url}）`;
  const lines = [head];
  if (att.kind === 'image') {
    lines.push(`（图片附件，已在对话界面展示；如你具备视觉能力请结合图片理解）`);
  } else if (att.kind === 'video') {
    lines.push(`（视频附件，界面可播放）`);
  }
  if (isWs && att.truncated) {
    lines.push('（注：该文件在空间内已截断存储，需要全文时可用 read_workspace_file 按路径读取）');
  }
  if (typeof att.textContent === 'string' && att.textContent.trim() && remainBudget > 200) {
    const budget = Math.min(ATTACHMENT_TEXT_INJECT_LIMIT, remainBudget);
    const content = att.textContent.length > budget
      ? `${att.textContent.slice(0, budget)}\n…（内容过长已截断，原文 ${att.textContent.length} 字符）`
      : att.textContent;
    lines.push('--- 文件内容开始 ---', content, '--- 文件内容结束 ---');
  } else if (att.kind !== 'image' && att.kind !== 'video') {
    lines.push('（二进制文件，未注入内容；如需分析请让用户粘贴关键内容）');
  }
  lines.push(tail);
  return lines.join('\n');
}

/**
 * 把用户输入与附件组装成发给 LLM 的 user content。
 * @returns {string} 注入后的完整文本（无附件时原样返回）
 */
export function buildUserContentWithAttachments(text, attachments = []) {
  const atts = (attachments || []).filter(a => a?.url || isWorkspaceAttachment(a));
  if (!atts.length) return text;
  const blocks = [];
  let budget = ATTACHMENT_TEXT_TOTAL_LIMIT;
  atts.forEach((att, i) => {
    const block = buildAttachmentBlock(att, budget);
    budget -= block.length;
    blocks.push(`【附件 ${i + 1}/${atts.length}】\n${block}`);
  });
  return `${text}\n\n---\n📎 本次消息携带 ${atts.length} 个附件：\n\n${blocks.join('\n\n')}`;
}

/**
 * 提取随消息持久化的附件元数据（剔除运行时字段，textContent 截断防存储膨胀）。
 */
export function toAttachmentMeta(attachments = []) {
  return (attachments || [])
    .map(a => {
      if (!a) return null;
      // 空间文件：不落 url/textContent（正文已整体注入消息 content，避免持久化双份膨胀）
      if (isWorkspaceAttachment(a)) {
        return {
          id: a.id,
          source: 'workspace',
          kind: 'file',
          name: a.name || '未命名',
          path: a.path || '',
          size: Number(a.size) || 0,
          ...(a.truncated ? { truncated: true } : {}),
        };
      }
      if (!a.url) return null;
      return {
        id: a.id,
        url: a.url,
        kind: a.kind || 'file',
        mime: a.mime || '',
        name: a.name || '未命名',
        size: Number(a.size) || 0,
        ...(typeof a.textContent === 'string' && a.textContent
          ? { textContent: a.textContent.slice(0, ATTACHMENT_TEXT_INJECT_LIMIT) }
          : {}),
      };
    })
    .filter(Boolean);
}
