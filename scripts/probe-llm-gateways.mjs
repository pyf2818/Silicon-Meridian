// 探测本机 LLM 网关可用性（API Switch 9090 / zen2api 9015）
const targets = [
  { name: 'api-switch-9090', url: 'http://127.0.0.1:9090/v1/models' },
  { name: 'zen2api-9015', url: 'http://127.0.0.1:9015/v1/models' },
];
for (const t of targets) {
  try {
    const res = await fetch(t.url, { signal: AbortSignal.timeout(4000) });
    const text = await res.text();
    let models = '';
    try {
      const json = JSON.parse(text);
      models = (json.data || []).map(m => m.id).slice(0, 12).join(',');
    } catch { models = text.slice(0, 120); }
    console.log(`${t.name}: HTTP ${res.status} | models: ${models}`);
  } catch (err) {
    console.log(`${t.name}: FAIL ${String(err?.cause?.code || err?.message).slice(0, 80)}`);
  }
}
