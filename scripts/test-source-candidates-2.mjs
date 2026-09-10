/**
 * v26.9 Task #23 第二轮：RSSHub 健康对照 + 二轮候选（含重试）
 * 用法：node scripts/test-source-candidates-2.mjs
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const RSSHUB = 'https://rsshub.rssforever.com';
const RSSHUB2 = 'https://rsshub.app';

const SANITY = [
  { name: '[对照] 新智元路由(已在用)', urls: [`${RSSHUB}/aminer/ai`] },
  { name: '[对照] 知乎热榜路由(已在用)', urls: [`${RSSHUB}/zhihu/hotlist`] },
];

const CANDIDATES = [
  // 大厂二轮补测
  { name: '腾讯 AlloyTeam', urls: ['https://www.alloyteam.com/feed/', 'https://www.alloyteam.com/feed'] },
  { name: '京东凹凸实验室', urls: ['https://aotu.io/rss2.xml', 'https://aotu.io/rss.xml', 'https://aotu.io/feed.xml'] },
  { name: '得物技术', urls: [`${RSSHUB}/dewu/blog`, `${RSSHUB2}/dewu/blog`] },
  { name: '七牛云技术', urls: ['https://blog.qiniu.com/feed/'] },
  { name: '网易云音乐技术', urls: [`${RSSHUB}/163/music/blog`, 'https://sq.163yun.com/blog/rss'] },
  // 博主二轮补测（重试）
  { name: '宝玉博客', urls: ['https://baoyu.io/feed.xml', `${RSSHUB}/baoyu/translations`] },
  { name: 'DIYGod 博客', urls: ['https://diygod.me/atom.xml', 'https://diygod.cc/atom.xml'] },
  { name: 'Phodal 博客', urls: ['https://www.phodal.com/rss/', 'https://www.phodal.com/api/blog/rss/'] },
  { name: '我爱自然语言处理', urls: ['https://www.52nlp.cn/feed', 'https://52nlp.cn/feed'] },
  { name: '芋道源码', urls: ['http://www.iocoder.cn/feed', 'https://www.iocoder.cn/feed'] },
  { name: '知乎 苏洋 soulteary', urls: [`${RSSHUB}/zhihu/people/posts/soulteary`, `${RSSHUB2}/zhihu/people/posts/soulteary`] },
  { name: 'CSDN 快手技术团队', urls: [`${RSSHUB}/csdn/user/blog/Kwai_tech`, `${RSSHUB2}/csdn/user/blog/Kwai_tech`] },
  // 权威媒体 / 机构二轮
  { name: '新华网科技', urls: ['http://www.news.cn/tech/rss_news.xml', 'https://www.news.cn/tech/rss_news.xml'] },
  { name: '人民网科技', urls: ['http://scitech.people.com.cn/rss/tech.xml', 'https://scitech.people.com.cn/rss/tech.xml'] },
  { name: '机器翻译学堂', urls: ['https://colloquial.cn/feed', `${RSSHUB}/colloquial/posts`] },
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
  return ((text.match(/<item[\s>]/g) || []).length) + ((text.match(/<entry[\s>]/g) || []).length);
}

function looksLikeFeed(text) {
  const head = text.slice(0, 800).toLowerCase();
  if (!(head.includes('<rss') || head.includes('<feed') || head.includes('<?xml'))) return false;
  return /<(rss|feed)[\s>]/i.test(text.slice(0, 2000));
}

async function testUrl(url) {
  const { res, err } = await fetchWithTimeout(url);
  if (err) return { ok: false, detail: `网络错误: ${err.name === 'AbortError' ? '超时' : err.cause?.code || err.message}` };
  if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
  const text = await res.text();
  if (!looksLikeFeed(text)) return { ok: false, detail: `非 feed 内容 (${res.headers.get('content-type') || 'unknown'}, ${text.length}B)` };
  const n = countItems(text);
  if (n === 0) return { ok: false, detail: 'feed 有效但 0 条目' };
  return { ok: true, detail: `${n} 条目, ${text.length}B` };
}

const results = [];
for (const cand of [...SANITY, ...CANDIDATES]) {
  let winner = null;
  for (const url of cand.urls) {
    let r = await testUrl(url);
    if (!r.ok) r = await testUrl(url); // 失败重试一次
    if (r.ok) { winner = { url, ...r }; break; }
    winner = { url, ...r };
  }
  results.push({ name: cand.name, ...winner });
  console.log(`${winner.ok ? '✅ PASS' : '❌ FAIL'} | ${cand.name} | ${winner.url} | ${winner.detail}`);
}

console.log('\n===== 通过清单 =====');
const pass = results.filter((r) => r.ok);
console.log(`通过 ${pass.length}/${results.length}`);
console.log(JSON.stringify(pass.map((r) => ({ name: r.name, url: r.url })), null, 2));
