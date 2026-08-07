import urllib.request, urllib.parse, ssl, json, time
from concurrent.futures import ThreadPoolExecutor, as_completed

ssl._create_default_https_context = ssl._create_unverified_context
BASE = "http://localhost:5176"
TIMEOUT = 20

# 62个新增源（与constants.js中L922-L994修改后完全一致）
SOURCES = {
    "【P0 国际标准/监管】": [
        ("ISO News", "https://news.google.com/rss/search?q=ISO+standardization+international&hl=en&gl=US&ceid=US:en"),
        ("IEC News", "https://news.google.com/rss/search?q=IEC+electrotechnical+standard&hl=en&gl=US&ceid=US:en"),
        ("IEEE Standards", "https://news.google.com/rss/search?q=IEEE+standard+technology&hl=en&gl=US&ceid=US:en"),
        ("OECD Science", "https://news.google.com/rss/search?q=OECD+science+technology+policy&hl=en&gl=US&ceid=US:en"),
        ("EU AI Office", "https://digital-strategy.ec.europa.eu/en/news/rss"),
        ("White House OSTP", "https://www.whitehouse.gov/feed/"),
    ],
    "【P0 中国官方权威】": [
        ("国务院新闻办", "https://rsshub.rssforever.com/gov/scio/xwfb"),
        ("国家发改委", "https://rsshub.rssforever.com/gov/ndrc/gyjj"),
        ("国家网信办", "https://rsshub.rssforever.com/gov/cac/xwzx"),
        ("国家标准化管理委员会", "https://rsshub.rssforever.com/gov/sac"),
        ("中国科学院", "https://rsshub.rssforever.com/cas/kyjz"),
        ("中国工程院", "https://rsshub.rssforever.com/cae/xsdt"),
        ("中国科协", "https://rsshub.rssforever.com/gov/cast/xwbd"),
        ("人工智能标椎总体组", "https://rsshub.rssforever.com/simple-sitemap-parser?url=https%3A%2F%2Fwww.aii-alliance.org%2F&sitemap=false"),
        ("CAAI", "https://rsshub.rssforever.com/simple-sitemap-parser?url=https%3A%2F%2Fwww.caai.cn%2F&sitemap=false"),
        ("CCF", "https://rsshub.rssforever.com/ccf/news"),
        ("BAAI", "https://rsshub.rssforever.com/simple-sitemap-parser?url=https%3A%2F%2Fwww.baai.ac.cn%2F&sitemap=false"),
        ("之江实验室", "https://rsshub.rssforever.com/simple-sitemap-parser?url=https%3A%2F%2Fwww.zhejianglab.com%2F&sitemap=false"),
        ("上海AI Lab", "https://rsshub.rssforever.com/simple-sitemap-parser?url=https%3A%2F%2Fwww.shlab.org.cn%2F&sitemap=false"),
    ],
    "【P0 海外AI独角兽】": [
        ("xAI Blog", "https://blog.x.ai/rss"),
        ("Groq Blog", "https://newsroom.groq.com/rss"),
        ("Databricks", "https://www.databricks.com/feed"),
        ("Perplexity", "https://blog.perplexity.ai/feed.xml"),
        ("Character.AI", "https://character.ai/blog.atom"),
        ("Inflection", "https://rsshub.rssforever.com/simple-sitemap-parser?url=https%3A%2F%2Finflection.ai%2Fblog&sitemap=false"),
        ("Replicate", "https://rsshub.rssforever.com/simple-sitemap-parser?url=https%3A%2F%2Freplicate.com%2Fblog&sitemap=false"),
        ("Together AI", "https://www.together.ai/blog/feed.xml"),
        ("Fireworks AI", "https://fireworks.ai/blog/rss.xml"),
        ("Modal", "https://rsshub.rssforever.com/simple-sitemap-parser?url=https%3A%2F%2Fmodal.com%2Fblog&sitemap=false"),
        ("Cerebras", "https://rsshub.rssforever.com/simple-sitemap-parser?url=https%3A%2F%2Fwww.cerebras.net%2Fblog%2F&sitemap=false"),
        ("Tenstorrent", "https://rsshub.rssforever.com/simple-sitemap-parser?url=https%3A%2F%2Ftenstorrent.com%2Fblog%2F&sitemap=false"),
    ],
    "【P0 国内AI大厂】": [
        ("百度研究院", "https://rsshub.rssforever.com/simple-sitemap-parser?url=https%3A%2F%2Fresearch.baidu.com%2F&sitemap=false"),
        ("飞桨", "https://rsshub.rssforever.com/simple-sitemap-parser?url=https%3A%2F%2Fwww.paddlepaddle.org.cn%2F&sitemap=false"),
        ("阿里达摩院", "https://rsshub.rssforever.com/simple-sitemap-parser?url=https%3A%2F%2Fdamo.alibaba.com%2F&sitemap=false"),
        ("通义实验室", "https://rsshub.rssforever.com/simple-sitemap-parser?url=https%3A%2F%2Ftongyi.aliyun.com%2F&sitemap=false"),
        ("火山引擎AI", "https://rsshub.rssforever.com/simple-sitemap-parser?url=https%3A%2F%2Fwww.volcengine.com%2Fai&sitemap=false"),
        ("腾讯混元", "https://rsshub.rssforever.com/simple-sitemap-parser?url=https%3A%2F%2Fhunyuan.tencent.com%2F&sitemap=false"),
        ("腾讯优图", "https://rsshub.rssforever.com/simple-sitemap-parser?url=https%3A%2F%2Fopen.youtu.qq.com%2F&sitemap=false"),
        ("华为诺亚", "https://rsshub.rssforever.com/simple-sitemap-parser?url=https%3A%2F%2Fwww.noahlab.com.hk%2F&sitemap=false"),
        ("昇腾社区", "https://rsshub.rssforever.com/simple-sitemap-parser?url=https%3A%2F%2Fwww.hiascend.com%2Fzh%2F&sitemap=false"),
        ("讯飞研究院", "https://rsshub.rssforever.com/simple-sitemap-parser?url=https%3A%2F%2Fwww.xfyun.cn%2Fresearch&sitemap=false"),
        ("商汤", "https://rsshub.rssforever.com/simple-sitemap-parser?url=https%3A%2F%2Fwww.sensetime.com%2Fcn&sitemap=false"),
        ("旷视", "https://rsshub.rssforever.com/simple-sitemap-parser?url=https%3A%2F%2Fwww.megvii.com%2F&sitemap=false"),
        ("MiniMax", "https://rsshub.rssforever.com/simple-sitemap-parser?url=https%3A%2F%2Fwww.minimaxi.com%2F&sitemap=false"),
        ("StepFun", "https://rsshub.rssforever.com/simple-sitemap-parser?url=https%3A%2F%2Fstepfun.com%2F&sitemap=false"),
        ("零一万物", "https://rsshub.rssforever.com/simple-sitemap-parser?url=https%3A%2F%2Fwww.lingyiwanwu.com%2F&sitemap=false"),
        ("Moonshot", "https://rsshub.rssforever.com/simple-sitemap-parser?url=https%3A%2F%2Fwww.moonshot.cn%2F&sitemap=false"),
        ("百川智能", "https://rsshub.rssforever.com/simple-sitemap-parser?url=https%3A%2F%2Fwww.baichuan-ai.com%2F&sitemap=false"),
        ("深言科技", "https://rsshub.rssforever.com/simple-sitemap-parser?url=https%3A%2F%2Fwww.deeplang.ai%2F&sitemap=false"),
    ],
    "【P1 产业联盟/专业媒体】": [
        ("AI Alliance", "https://rsshub.rssforever.com/simple-sitemap-parser?url=https%3A%2F%2Fthealliance.ai%2Fnews&sitemap=false"),
        ("Partnership on AI", "https://www.partnershiponai.org/feed/"),
        ("SemiAnalysis", "https://semianalysis.substack.com/feed"),
        ("NextPlatform", "https://rsshub.rssforever.com/simple-sitemap-parser?url=https%3A%2F%2Fwww.nextplatform.com%2Fcategory%2Ffeatures%2F&sitemap=false"),
        ("WikiChip", "https://rsshub.rssforever.com/simple-sitemap-parser?url=https%3A%2F%2Ffuse.wikichip.org%2Fnews%2F&sitemap=false"),
        ("半导体行业观察", "https://rsshub.rssforever.com/jiweixin"),
        ("CNCF Blog", "https://www.cncf.io/blog/feed/"),
        ("K8s Blog", "https://kubernetes.io/feed.xml"),
        ("Terraform", "https://www.hashicorp.com/blog/feed.xml"),
        ("CB Insights", "https://www.cbinsights.com/feed/"),
        ("PitchBook", "https://pitchbook.com/news/feed"),
        ("a16z AI", "https://a16z.com/feed/"),
        ("Sequoia", "https://www.sequoiacap.com/rss"),
    ],
}

# 先探测dev server
try:
    urllib.request.urlopen(BASE + "/", timeout=5).read(100)
    print(f"[OK] dev server {BASE} ready\n")
except Exception as e:
    print(f"[FATAL] 无法连接: {e}")
    import sys
    sys.exit(1)

def verify(name, url):
    t0 = time.time()
    try:
        full = f"{BASE}/api/verify-source?url={urllib.parse.quote(url, safe='')}"
        req = urllib.request.Request(full, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            body = r.read().decode("utf-8", "ignore")
            try:
                data = json.loads(body)
            except Exception:
                data = {"_raw": body[:200]}
            ms = int((time.time() - t0) * 1000)
            ok = bool(data.get("ok") or data.get("valid") or data.get("title") or (isinstance(data, dict) and isinstance(data.get("items"), list) and len(data["items"]) > 0))
            if not ok and (r.status == 200 or data.get("status") == 200):
                if data.get("title") or data.get("items") or data.get("feedType"):
                    ok = True
            return (name, url, ok, ms, data)
    except Exception as e:
        ms = int((time.time() - t0) * 1000)
        return (name, url, False, ms, {"error": str(e)[:180]})

flat = []
for g, items in SOURCES.items():
    for n, u in items:
        flat.append((g, n, u))

results = {g: [] for g in SOURCES}
with ThreadPoolExecutor(max_workers=6) as ex:
    fmap = {}
    for g, n, u in flat:
        fmap[ex.submit(verify, n, u)] = (g, n)
    done = 0
    for fut in as_completed(fmap):
        g, n = fmap[fut]
        try:
            r = fut.result()
        except Exception as e:
            r = (n, "", False, 0, {"error": str(e)})
        results[g].append(r)
        done += 1
        mark = "✅" if r[2] else "❌"
        # 只打印失败避免刷屏太多
        if not r[2]:
            print(f"  [{done:02d}/{len(flat)}] {mark} {r[0]}  {r[3]}ms")
        else:
            print(f"  [{done:02d}/{len(flat)}] {mark} {r[0]}  {r[3]}ms")

total_ok = total_fail = 0
print("\n" + "=" * 80)
print("  第二轮连通性检测报告（修复后）")
print("=" * 80)
for g, items in results.items():
    oks = [x for x in items if x[2]]
    fails = [x for x in items if not x[2]]
    total_ok += len(oks); total_fail += len(fails)
    print(f"\n{g}  ✅{len(oks)}  ❌{len(fails)}")
    for r in items:
        name, url, ok, ms, info = r
        mark = "✅" if ok else "❌"
        extra = ""
        if not ok and isinstance(info, dict):
            extra = f"  — {info.get('error') or info.get('message') or info.get('status') or json.dumps(info, ensure_ascii=False)[:100]}"
        if not ok:
            print(f"   {mark} {name:16s}  {ms:5d}ms  {extra}")
        else:
            extra_info = ""
            if isinstance(info, dict):
                n = 0
                if isinstance(info.get("items"), list): n = len(info["items"])
                t = info.get("title") or ""
                if t or n: extra_info = f"  — title={t[:40]} items={n}"
            print(f"   {mark} {name:16s}  {ms:5d}ms{extra_info}")

N = len(flat)
print("\n" + "-" * 80)
print(f"汇总：新增 {N} 源  |  ✅ 成功 {total_ok} ({total_ok/N*100:.1f}%)  |  ❌ 失败 {total_fail} ({total_fail/N*100:.1f}%)")
print("=" * 80)
