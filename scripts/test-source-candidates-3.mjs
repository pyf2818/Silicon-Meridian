/**
 * v26.9 Task #23 第三轮：备用 RSSHub 实例探测 + 直连源补测
 * 用法：node scripts/test-source-candidates-3.mjs
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

const INSTANCES = ['https://rsshub.rssforever.com', 'https://rsshub.rss.tips', 'https://rsshub.pseudoyu.com', 'https://rsshub.ktachibana.party', 'https://rss.injahow.cn', 'https://rsshub.moeyy.xyz'];

const DIRECT = [
  { name: '智东西', urls: ['https://zhidx.com/feed', 'https://zhidx.com/feed/'] },
  { name: 'DeepTech 深科技', urls: ['https://www.mittrchina.com/rss', 'https://www.mittrchina.com/feed'] },
  { name: 'InfoQ 中文站', urls: ['https://www.infoq.cn/feed', 'https://www.infoq.cn/feed.xml'] },
  { name: '甲子光年', urls: ['https://www.jiazhi.com/rss', 'https://www.jiazhiyuan.com/feed'] },
  { name: '机器学习算法与自然语言处理', urls: ['https://mlnlp.cn/feed', 'https://mlnlp-web.github.io/feed.xml'] },
  { name: '开源社区 Linux 中国', urls: ['https://linux.cn/rss.xml', 'https://linux.cn/backend/rss.xml'] },
];

async function fetchWithTimeout(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
      redirect: 'follow',
    });
    return { res };
  } catch (err) {
    return { err };
  } finally {
    clearTimeout(timer);
  }
}

function countItems(text) {
  return ((text.match(/<item[\s>]/g) || []).length) + ((text.match(/<entry[\s>]/g) || []).length);
}

async function testUrl(url) {
  const { res, err } = await fetchWithTimeout(url);
  if (err) return { ok: false, detail: `网络错误: ${err.name === 'AbortError' ? '超时' : err.cause?.code || err.message}` };
  if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
  const text = await res.text();
  const head = text.slice(0, 800).toLowerCase();
  if (!(head.includes('<rss') || head.includes('<feed') || head.includes('<?xml'))) {
    return { ok: false, detail: `非 feed (${res.headers.get('content-type') || 'unknown'}, ${text.length}B)` };
  }
  const n = countItems(text);
  if (n === 0) return { ok: false, detail: 'feed 有效但 0 条目' };
  return { ok: true, detail: `${n} 条目, ${text.length}B` };
}

// ===== 1) 实例探测：用已知好路由 /github/trending/daily/javascript 对照 =====
console.log('===== RSSHub 实例探测 =====');
let goodInstance = null;
for (const base of INSTANCES) {
  const r1 = await testUrl(`${base}/github/trending/daily/javascript`);
  const r2 = r1.ok ? r1 : await testUrl(`${base}/zhihu/hotlist`);
  console.log(`${r2.ok ? '✅' : '❌'} | ${base} | ${r2.detail}`);
  if (r2.ok && !goodInstance) goodInstance = base;
}
console.log(`可用实例: ${goodInstance || '无'}\n`);

// ===== 2) 直连源补测 =====
console.log('===== 直连源补测 =====');
const results = [];
for (const cand of DIRECT) {
  let winner = null;
  for (const url of cand.urls) {
    let r = await testUrl(url);
    if (!r.ok) r = await testUrl(url);
    if (r.ok) { winner = { url, ...r }; break; }
    winner = { url, ...r };
  }
  results.push({ name: cand.name, ...winner });
  console.log(`${winner.ok ? '✅ PASS' : '❌ FAIL'} | ${cand.name} | ${winner.url} | ${winner.detail}`);
}

// ===== 3) 若有可用实例，测 RSSHub 依赖候选 =====
if (goodInstance) {
  console.log(`\n===== 在 ${goodInstance} 上重测 RSSHub 依赖候选 =====`);
  const RHUB = [
    { name: '新智元', path: '/aminer/ai' },
    { name: '得物技术', path: '/dewu/blog' },
    { name: '知乎 苏洋 soulteary', path: '/zhihu/people/posts/soulteary' },
    { name: 'CSDN 快手技术团队', path: '/csdn/user/blog/Kwai_tech' },
    { name: '稀土掘金 AI', path: '/juejin/tag/人工智能' },
  ];
  for (const cand of RHUB) {
    const url = `${goodInstance}${cand.path}`;
    let r = await testUrl(url);
    if (!r.ok) r = await testUrl(url);
    results.push({ name: cand.name, url: r.ok ? url : null, ...r });
    console.log(`${r.ok ? '✅ PASS' : '❌ FAIL'} | ${cand.name} | ${url} | ${r.detail}`);
  }
}

console.log('\n===== 通过清单 =====');
const pass = results.filter((r) => r.ok);
console.log(`通过 ${pass.length}/${results.length}`);
console.log(JSON.stringify(pass.map((r) => ({ name: r.name, url: r.url })), null, 2));
