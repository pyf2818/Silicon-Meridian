/**
 * 信息源候选实测脚本 · 第 5 批：突发与社区脉搏源
 * 用法：node scripts/test-source-candidates-5.mjs
 * 背景：用户点名要「最新、最热、最有价值」——突发事件的最早信号往往来自
 *       社区热榜与安全媒体（智谱泄露类事件先在社区/公告爆出，晚数小时才有正式报道）。
 * 规则同前几批：每个候选多备用 URL，验证 HTTP 200 + feed 结构 + 条目数，PASS 才接入。
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const RSSHUB = 'https://rsshub.rssforever.com';

const CANDIDATES = [
  // ===== 全球突发 / 社区脉搏 =====
  { name: 'Hacker News 前排', urls: ['https://hnrss.org/frontpage'] },
  { name: 'The Hacker News', urls: ['https://feeds.feedburner.com/TheHackersNews', 'https://thehackernews.com/feeds/posts/default'] },
  { name: 'BleepingComputer', urls: ['https://www.bleepingcomputer.com/feed/'] },
  { name: 'Ars Technica', urls: ['https://feeds.arstechnica.com/arstechnica/index', 'https://feeds.arstechnica.com/arstechnica/technology-lab'] },
  { name: 'TechCrunch', urls: ['https://techcrunch.com/feed/', 'https://techcrunch.com/feed'] },
  // ===== 中文突发 / 社区脉搏 =====
  { name: '36氪', urls: ['https://36kr.com/feed', 'https://36kr.com/feed/'] },
  { name: 'V2EX', urls: ['https://www.v2ex.com/index.xml', 'https://v2ex.com/index.xml'] },
  { name: '微博热搜（RSSHub）', urls: [`${RSSHUB}/weibo/search/hot`] },
  { name: '知乎热榜（RSSHub）', urls: [`${RSSHUB}/zhihu/hotlist`] },
  { name: 'GitHub Trending（RSSHub）', urls: [`${RSSHUB}/github/trending/daily/any`] },
];

async function fetchWithTimeout(url, timeoutMs = 15000) {
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
  const items = (text.match(/<item[\s>]/g) || []).length;
  const entries = (text.match(/<entry[\s>]/g) || []).length;
  return items + entries;
}

const results = [];
for (const cand of CANDIDATES) {
  let ok = false;
  const tried = [];
  for (const url of cand.urls) {
    tried.push(url);
    const { res, err } = await fetchWithTimeout(url);
    if (err) { tried.push(`  ✗ ${err.message || err}`); continue; }
    if (!res.ok) { tried.push(`  ✗ http ${res.status}`); continue; }
    const text = await res.text();
    const count = countItems(text);
    if (count === 0) { tried.push(`  ✗ 非 feed 结构（0 条目）`); continue; }
    tried.push(`  ✓ ${count} 条目`);
    results.push({ name: cand.name, url, count, pass: true });
    ok = true;
    break;
  }
  if (!ok) results.push({ name: cand.name, pass: false });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${cand.name}`);
  tried.forEach(t => console.log('   ', t));
}

console.log('\n===== 汇总（PASS 才接入 DEFAULT_SOURCES）=====');
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.url ? `  ${r.url}  (${r.count} 条)` : ''}`);
}
