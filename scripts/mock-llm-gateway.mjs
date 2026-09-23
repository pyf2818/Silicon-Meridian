// 本地 mock LLM 网关（OpenAI 兼容）——编辑层 + agent 循环端到端实测用
// 两种模式自动识别：
//   1. 编辑层（system 含「科技资讯编辑」）→ 非流式 JSON，动态提取真实条目 id 返回 picks
//   2. agent 循环（stream:true）→ OpenAI SSE：
//      第 1 轮（无 tool 消息）返回 web_search 工具调用；第 2 轮（有 tool 消息）收敛输出 markdown
import http from 'node:http';

const PORT = 9100;

function sseChunk(obj) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

function sseContent(res, text) {
  res.write(sseChunk({ id: 'mock-agent', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: text }, finish_reason: null }] }));
}

function handleAgentStream(res, body) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const hasToolMsg = Array.isArray(body?.messages) && body.messages.some(m => m.role === 'tool');
  if (!hasToolMsg) {
    // 第 1 轮：发起一个工具调用（分两个 delta 模拟真实分片）
    res.write(sseChunk({ choices: [{ index: 0, delta: { role: 'assistant', content: null }, finish_reason: null }] }));
    res.write(sseChunk({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_mock_1', type: 'function', function: { name: 'search_news', arguments: '' } }] }, finish_reason: null }] }));
    res.write(sseChunk({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"keyword":"Codex 流式输出"}' } }] }, finish_reason: null }] }));
    res.write(sseChunk({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }));
  } else {
    // 第 2 轮：收敛输出 markdown 正文（分 3 个 content delta 模拟流式）
    sseContent(res, '## 检索结果\n\n');
    sseContent(res, 'Codex 的流式输出把**执行过程弱化为终端日志行**，答案在下方沉淀：\n\n');
    sseContent(res, '- 工具调用单行紧凑（状态符 + 名称 + 参数摘要 + 耗时）\n- 完成后折叠为「执行了 N 步」摘要\n\n以上为 mock 网关的收敛回答。');
    res.write(sseChunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }));
  }
  res.write('data: [DONE]\n\n');
  res.end();
}

function handleEditor(res, body) {
  const raw = JSON.stringify(body);
  const ids = [...raw.matchAll(/(?:^|\\n)(\S+?) \| /g)].map(m => m[1]);
  const unique = [...new Set(ids)].filter(id => id && id !== 'JSON：');
  const picks = unique.slice(0, 3);
  const noise = unique.slice(3, 4);
  const notes = picks.slice(0, 2).map(id => ({ id, note: '编辑层实测：该条信息增量高，建议优先阅读。' }));
  const content = JSON.stringify({ picks, noise, notes });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    id: 'mock-editor', object: 'chat.completion', model: 'mock-fast',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  }));
  console.log(`[mock-llm] editor served: ${unique.length} ids -> picks=${picks.length}`);
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url?.includes('/chat/completions')) {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      let parsed = {};
      try { parsed = JSON.parse(body); } catch { /* ignore */ }
      const isEditor = JSON.stringify(parsed?.messages || '').includes('科技资讯编辑');
      if (parsed?.stream) {
        handleAgentStream(res, parsed);
        console.log(`[mock-llm] agent stream round (toolMsg=${Array.isArray(parsed?.messages) && parsed.messages.some(m => m.role === 'tool')})`);
      } else if (isEditor) {
        handleEditor(res, parsed);
      } else {
        // 兜底：非流式普通回答
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 'mock-plain', object: 'chat.completion', model: 'mock-fast', choices: [{ index: 0, message: { role: 'assistant', content: '（mock 默认回答）' }, finish_reason: 'stop' }] }));
      }
    });
    return;
  }
  if (req.method === 'GET' && req.url?.includes('/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'mock-fast' }] }));
    return;
  }
  res.writeHead(404); res.end();
});
server.listen(PORT, '127.0.0.1', () => console.log(`[mock-llm] listening on http://127.0.0.1:${PORT}/v1`));
