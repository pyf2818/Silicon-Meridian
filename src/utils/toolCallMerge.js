/**
 * 把流式 SSE 里的 tool_calls 分片按 index 合并还原为完整 tool_calls 数组。
 *
 * OpenAI 流式协议中，同一个工具的 name / arguments 会被切成多段、以 index 标识顺序到达，
 * 这里负责把它们拼接回 { id, type, function:{ name, arguments } }（蛇形键名，与后端一致）。
 * 纯函数，无任何 I/O，便于单测与复用。
 *
 * 历史卫生（2026-09-11，修「Assistant tool call .arguments must be valid JSON」400）：
 * 合并结果会原样进入 conversationMessages 历史，之后每轮请求都带着它发给上游。
 * 若参数流被截断（max_tokens 耗尽 / 流中断），拼接出的 arguments 是半截 JSON——
 * 原样回传会让上游整包 400，该会话从此卡死。因此输出前强制：
 *   - arguments 必须是合法 JSON，非法（截断/损坏）一律替换为 '{}'；
 *     模型会从随后的「参数不是合法 JSON」工具错误回灌中自修。
 *     （有意不做截断补齐修复：修出来的"合法但错误"参数会被 schema 放行并真执行，
 *      write_workspace_file 写半截内容是数据事故——安全失败优于垃圾执行。）
 *   - id 为空时生成占位 id（部分上游对空 tool_call_id 同样 400，且 tool 消息
 *     tool_call_id 必须能与 assistant.tool_calls 匹配）。
 *
 * @param {Array<Array>} batches 每批 delta.tool_calls（元素可能含 undefined / 空数组）
 * @returns {Array|undefined} 还原后的 tool_calls 数组；未出现任何工具分片时返回 undefined
 */
export function mergeToolCallDeltas(batches) {
  const toolAcc = new Map(); // index -> { id, type, function:{ name, arguments } }
  let saw = false;
  for (const batch of batches) {
    if (!Array.isArray(batch) || batch.length === 0) continue;
    saw = true;
    for (const tc of batch) {
      const idx = Number(tc.index ?? 0);
      if (!toolAcc.has(idx)) {
        toolAcc.set(idx, { id: tc.id || '', type: tc.type || 'function', function: { name: '', arguments: '' } });
      }
      const acc = toolAcc.get(idx);
      if (tc.id) acc.id = acc.id || tc.id;
      if (tc.type) acc.type = tc.type;
      if (tc.function?.name) acc.function.name += tc.function.name;
      if (tc.function?.arguments) acc.function.arguments += tc.function.arguments;
    }
  }
  if (!saw || toolAcc.size === 0) return undefined;
  return [...toolAcc.values()].map((t, i) => {
    const rawArgs = String(t.function.arguments || '');
    let safeArgs;
    if (rawArgs.trim() === '') {
      safeArgs = '{}';
    } else {
      try { JSON.parse(rawArgs); safeArgs = rawArgs; } catch { safeArgs = '{}'; }
    }
    return {
      id: String(t.id || '') || `call_delta_${i}`,
      type: 'function',
      function: { name: String(t.function.name || ''), arguments: safeArgs },
    };
  });
}
