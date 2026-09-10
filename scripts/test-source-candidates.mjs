/**
 * v26.9 Task #23：信息源候选实测脚本
 * 用法：node scripts/test-source-candidates.mjs
 * 规则：每个候选源尝试多个备用 URL（官方 RSS 优先，RSSHub 兜底），
 *       依次验证 HTTP 200 + XML/JSON feed 结构 + 条目数，输出 PASS/FAIL 表。
 * 只有测试通过的 URL 才会接入 DEFAULT_SOURCES。
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const RSSHUB = 'https://rsshub.rssforever.com';

const CANDIDATES = [
  // ===== 国内大厂技术团队博客 =====
  { name: '京东凹凸实验室', urls: ['https://aotu.io/atom.xml'] },
  { name: '饿了么前端', urls: ['https://fe.ele.me/atom.xml'] },
  { name: '百度 FEX', urls: ['https://fex.baidu.com/feed/', 'https://fex.baidu.com/rss/'] },
  { name: '腾讯 AlloyTeam', urls: ['https://www.alloyteam.com/feed/', 'https://www.alloyteam.com/feed'] },
  { name: '有赞技术', urls: ['https://tech.youzan.com/feed/', 'https://tech.youzan.com/atom.xml'] },
  { name: '得物技术', urls: [`${RSSHUB}/dewu/tech/blog`, 'https://tech.dewu.com/feed'] },
  { name: '360 技术博客', urls: ['https://blogs.360.cn/feed/', 'https://blogs.360.cn/feed'] },
  { name: '七牛云技术', urls: ['https://blog.qiniu.com/feed/', 'https://blog.qiniu.com/rss'] },
  { name: '网易 FEX', urls: ['https://sq.163yun.com/blog/rss', `${RSSHUB}/you163/tech`] },
  // ===== 国内技术博主 / 领域专家 =====
  { name: '宝玉博客', urls: ['https://baoyu.io/feed.xml'] },
  { name: 'DIYGod 博客', urls: ['https://diygod.me/atom.xml', 'https://diygod.cc/atom.xml'] },
  { name: '云风博客', urls: ['https://blog.codingnow.com/atom.xml'] },
  { name: 'Phodal 博客', urls: ['https://www.phodal.com/rss/', 'https://www.phodal.com/feed/'] },
  { name: '我爱自然语言处理', urls: ['https://www.52nlp.cn/feed', 'http://www.52nlp.cn/feed'] },
  { name: '程序师视野', urls: ['https://www.techug.com/feed', 'https://www.techug.com/feed/'] },
  { name: '芋道源码', urls: ['http://www.iocoder.cn/feed/', 'https://www.iocoder.cn/feed/'] },
  { name: 'karminski 牙医', urls: ['https://blog.karminski.io/feed', 'https://karminski-精做了rss无此路由占位.invalid'] },
  // ===== 权威机构 / 学术 / 监管 =====
  { name: '网信办（RSSHub）', urls: [`${RSSHUB}/gov/cac`, `${RSSHUB}/gov/cac/xinwen`] },
  { name: '中国信通院（RSSHub）', urls: [`${RSSHUB}/gov/caict`, `${RSSHUB}/caict/news`] },
  { name: '智源社区', urls: [`${RSSHUB}/baai/hub`, 'https://hub.baai.ac.cn/rss'] },
  { name: '集智俱乐部', urls: ['https://www.swarma.org/rss?', `${RSSHUB}/swarma/pattern`] },
  { name: 'AI 科技评论（雷峰网）', urls: ['https://www.leiphone.com/feed', 'https://www.leiphone.com/feed/'] },
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
  if (!looksLikeFeed(text)) return { ok: false, detail: `非 feed 内容 (${res.headers.get('content-type') || 'unknown type'}, ${text.length}B)` };
  const n = countItems(text);
  if (n === 0) return { ok: false, detail: 'feed 有效但 0 条目' };
  return { ok: true, detail: `${n} 条目, ${text.length}B` };
}

const results = [];
for (const cand of CANDIDATES) {
  let winner = null;
  for (const url of cand.urls) {
    if (url.includes('.invalid')) { winner = { url, ...{ ok: false, detail: '跳过（无已知 RSS）' } }; continue; }
    const r = await testUrl(url);
    if (r.ok) { winner = { url, ...r }; break; }
    winner = { url, ...r };
  }
  results.push({ name: cand.name, ...winner });
  console.log(`${winner.ok ? '✅ PASS' : '❌ FAIL'} | ${cand.name} | ${winner.url} | ${winner.detail}`);
}

console.log('\n===== 汇总 =====');
const pass = results.filter((r) => r.ok);
console.log(`通过 ${pass.length}/${results.length}`);
console.log(JSON.stringify(pass.map((r) => ({ name: r.name, url: r.url })), null, 2));
