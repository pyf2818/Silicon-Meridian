/**
 * 把流式 SSE 里的 tool_calls 分片按 index 合并还原为完整 tool_calls 数组。
 *
 * OpenAI 流式协议中，同一个工具的 name / arguments 会被切成多段、以 index 标识顺序到达，
 * 这里负责把它们拼接回 { id, type, function:{ name, arguments } }（蛇形键名，与后端一致）。
 * 纯函数，无任何 I/O，便于单测与复用。
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
  return [...toolAcc.values()].map(t => ({
    id: String(t.id || ''),
    type: 'function',
    function: { name: String(t.function.name || ''), arguments: String(t.function.arguments || '{}') },
  }));
}
