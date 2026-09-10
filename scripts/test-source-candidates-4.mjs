/**
 * v26.9 Task #23 第四轮：老牌科技媒体直连 RSS 补测
 * 用法：node scripts/test-source-candidates-4.mjs
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

const CANDIDATES = [
  { name: '新浪科技', urls: ['http://rss.sina.com.cn/news/tech/focus15.xml', 'https://rss.sina.com.cn/news/tech/focus15.xml'] },
  { name: '36氪快讯', urls: ['https://36kr.com/feed', 'https://36kr.com/feed/'] },
  { name: '钛媒体', urls: ['https://www.tmtpost.com/feed', 'https://www.tmtpost.com/rss'] },
  { name: '品玩 PingWest', urls: ['https://www.pingwest.com/feed', 'https://www.pingwest.com/feed/'] },
  { name: '腾讯科技', urls: ['http://feed.qq.com/tech_story.xml', 'https://feed.qq.com/tech_story.xml'] },
  { name: '爱范儿（校验在用源）', urls: ['https://www.ifanr.com/feed'] },
  { name: '少数派（校验在用源）', urls: ['https://sspai.com/feed'] },
  { name: '掘金 后端（injahow 实例）', urls: ['https://rss.injahow.cn/juejin/tag/后端'] },
  { name: '掘金 前端（injahow 实例）', urls: ['https://rss.injahow.cn/juejin/tag/前端'] },
];

async function fetchWithTimeout(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' }, redirect: 'follow' });
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
  if (!(head.includes('<rss') || head.includes('<feed') || head.includes('<?xml'))) return { ok: false, detail: `非 feed (${res.headers.get('content-type') || 'unknown'}, ${text.length}B)` };
  const n = countItems(text);
  if (n === 0) return { ok: false, detail: 'feed 有效但 0 条目' };
  return { ok: true, detail: `${n} 条目, ${text.length}B` };
}

const results = [];
for (const cand of CANDIDATES) {
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
console.log('\n===== 通过清单 =====');
const pass = results.filter((r) => r.ok);
console.log(JSON.stringify(pass.map((r) => ({ name: r.name, url: r.url })), null, 2));
