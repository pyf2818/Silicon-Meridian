// stripLeadingOrdinal.js
// 剥离模型回复正文开头孤立的「序号行」。
//
// 背景：工作站模型（GPT-6 Sol/Luna）稳定在正文最前面输出一个孤立的数字（如「0」）独占一行，
// 前端渲染忠实显示 → 用户看到每条回复开头都有个莫名其妙的 0。
// 提示词层已加【输出开头·硬性约束】（v8），模型仍会输出，故在渲染前做兜底剥离。
//
// 规则刻意收窄（避免误伤正文）：
//   - 只作用于正文最开头
//   - 只匹配「纯数字（可带 . 、 ) 等序号后缀）独占一行」并连同其后换行一并去掉
//   - 多行序号块（0\n1\n2）逐条剥离
//   - 后面必须还有正文内容才剥（避免把「只有一行数字」的合法回复清空）
export const LEADING_ORDINAL_RE = /^\s*\d{1,3}\s*[.、)）:：]?\s*(?:\r?\n)+/;

export function stripLeadingOrdinal(text) {
  if (typeof text !== 'string' || !text) return text;
  let out = text;
  // 逐条剥离开头的序号行；必须有剩余正文才继续（保底：至少保留最后一行）
  while (LEADING_ORDINAL_RE.test(out)) {
    const rest = out.replace(LEADING_ORDINAL_RE, '');
    if (!rest.trim()) return out; // 剥完就没内容了 → 保持原样，不误删
    out = rest;
  }
  return out;
}

export default stripLeadingOrdinal;
