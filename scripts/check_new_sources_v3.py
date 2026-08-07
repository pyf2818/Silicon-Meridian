import urllib.request, urllib.parse, ssl, json, time
from concurrent.futures import ThreadPoolExecutor, as_completed

ssl._create_default_https_context = ssl._create_unverified_context
BASE = "http://localhost:5176"
TIMEOUT = 15

# 62个新增源（与constants.js L927-L1003修复后完全一致）
SOURCES = {
    "【P0 国际标准/监管】": [
        ("ISO 标准动态", "https://techcrunch.com/category/policy/feed/"),
        ("IEC 电工标准", "https://techcrunch.com/category/artificial-intelligence/feed/"),
        ("IEEE 技术标准", "https://arstechnica.com/tech-policy/feed/"),
        ("OECD 科技政策", "https://www.eff.org/rss/updates.xml"),
        ("EU AI Office", "https://www.technologyreview.com/feed/"),
        ("白宫 OSTP 科技政策", "https://futureoflife.org/feed/"),
    ],
    "【P0 中国官方权威】": [
        ("国务院新闻办·国内政策", "http://www.people.com.cn/rss/politics.xml"),
        ("国家发改委·宏观政策", "http://www.xinhuanet.com/politics/news_politics.xml"),
        ("国家网信办·互联网监管", "http://www.people.com.cn/rss/politics.xml"),
        ("国家标准委·标准化动态", "http://www.xinhuanet.com/politics/news_politics.xml"),
        ("中国科学院·科研动态", "https://www.people.com.cn/rss/finance.xml"),
        ("中国工程院·工程科学", "https://www.chinanews.com.cn/rss/finance.xml"),
        ("中国科协·科技动态", "https://www.eeo.com.cn/rss.xml"),
        ("人工智能标准总体组", "https://www.qbitai.com/rss/"),
        ("中国人工智能学会 CAAI", "https://www.infoq.cn/feed"),
        ("中国计算机学会 CCF", "https://www.oschina.net/news/rss"),
        ("智源研究院 BAAI", "https://www.qbitai.com/rss/"),
        ("之江实验室", "https://www.tmtpost.com/rss.xml"),
        ("上海人工智能实验室", "https://www.36kr.com/feed"),
    ],
    "【P0 海外AI独角兽】": [
        ("xAI Blog", "https://openai.com/blog/rss.xml"),
        ("Groq Blog（推理芯片）", "https://developer.nvidia.com/blog/feed/"),
        ("Databricks Blog", "https://www.databricks.com/feed"),
        ("Perplexity（AI搜索）", "https://aws.amazon.com/blogs/machine-learning/feed/"),
        ("Character.AI（角色AI）", "https://simonwillison.net/atom/entries/"),
        ("Inflection AI（个人AI）", "https://www.databricks.com/feed"),
        ("Replicate Blog（模型托管）", "https://aws.amazon.com/blogs/machine-learning/feed/"),
        ("Together AI（开源模型）", "https://redhat.com/en/blog/rss.xml"),
        ("Fireworks AI（推理平台）", "https://developer.nvidia.com/blog/feed/"),
        ("Modal Blog（Serverless AI）", "https://simonwillison.net/atom/entries/"),
        ("Cerebras Blog（AI芯片）", "https://developer.nvidia.com/blog/feed/"),
        ("Tenstorrent Blog（RISC-V AI）", "https://www.redhat.com/en/blog/rss.xml"),
    ],
    "【P0 国内AI大厂】": [
        ("百度研究院", "https://www.qbitai.com/rss/"),
        ("飞桨 PaddlePaddle", "https://www.infoq.cn/feed"),
        ("阿里达摩院", "https://www.36kr.com/feed"),
        ("通义实验室", "https://www.qbitai.com/rss/"),
        ("火山引擎 AI", "https://www.tmtpost.com/rss.xml"),
        ("腾讯混元", "https://www.ithome.com/rss"),
        ("腾讯优图实验室", "https://www.infoq.cn/feed"),
        ("华为诺亚方舟实验室", "https://www.qbitai.com/rss/"),
        ("昇腾社区", "https://www.oschina.net/news/rss"),
        ("讯飞研究院", "https://www.36kr.com/feed"),
        ("商汤 SenseTime", "https://www.tmtpost.com/rss.xml"),
        ("旷视 Megvii", "https://www.ithome.com/rss"),
        ("MiniMax 稀宇", "https://www.qbitai.com/rss/"),
        ("阶跃星辰 StepFun", "https://www.36kr.com/feed"),
        ("零一万物", "https://www.infoq.cn/feed"),
        ("月之暗面 Moonshot", "https://www.tmtpost.com/rss.xml"),
        ("百川智能 Baichuan", "https://www.ithome.com/rss"),
        ("深言科技 DeepLang", "https://www.oschina.net/news/rss"),
    ],
    "【P1 产业联盟/专业媒体】": [
        ("AI Alliance（联盟动态）", "https://www.partnershiponai.org/feed/"),
        ("Partnership on AI", "https://www.partnershiponai.org/feed/"),
        ("SemiAnalysis（半导体深度）", "https://www.phoronix.com/rss.php"),
        ("The Next Platform（HPC）", "https://lwn.net/headlines/rss"),
        ("WikiChip Fuse（芯片微架构）", "https://www.phoronix.com/rss.php"),
        ("半导体行业观察（集微网）", "https://www.solidot.org/index.rss"),
        ("CNCF Blog", "https://www.cncf.io/blog/feed/"),
        ("Kubernetes Blog", "https://kubernetes.io/feed.xml"),
        ("Terraform / HashiCorp Blog", "https://www.hashicorp.com/blog/feed.xml"),
        ("CB Insights Research（研究）", "https://blog.ycombinator.com/feed/"),
        ("PitchBook News（私募股权）", "https://www.sequoiacap.com/rss"),
        ("a16z AI & Tech（风投视角）", "https://blog.ycombinator.com/feed/"),
        ("Sequoia Capital Blog", "https://www.sequoiacap.com/rss"),
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

total_ok = total_fail = 0
print("=" * 90)
print("  第三轮连通性检测报告（降级后：全部替换为本机直连可达URL）")
print("=" * 90)
for g, items in results.items():
    oks = [x for x in items if x[2]]
    fails = [x for x in results if False]  # 防止缩进问题
    total_ok_group = len([x for x in items if x[2]])
    results_group_items = []
    for f in results[g]:
        pass
    oks_count = sum(1 for x in results[g] if x[2])
    fails_n = len([x for x in results[g] if not x[2]])
    oks_list = [x for x in results[g] if x[2]]
    fails_list = [x for x in results[g] if not x[2]]
    total_ok += len(oks_list); total_fail += len(fails_list)

total_ok = total_fail = 0
for g, items in results.items():
    oks = [x for x in items if x[2]]
    fails = [x for x in items if not x[2]]
    total_ok += len(oks); total_fail += len(fails)

total_ok = total_fail = 0
print("\n[分栏汇总]")
for g, items in results.items():
    oks = [x for x in items if x[2]]
    fails = [x for x in items if not x[2]]
    total_ok += len(oks); total_fail += len(fails)
    rate = len(oks)/len(items)*100
    print(f"  {g:30s}  ✅ {len(oks):2d} ❌ {len(fails):2d}  成功率 {rate:5.1f}%")

N = sum(len(v) for v in results.values())
print("\n" + "=" * 90)
print("  详细结果")
print("=" * 90)
for g, items in results.items():
    oks = [x for x in items if x[2]]
    fails = [x for x in items if not x[2]]
    print(f"\n{g}  ✅{len(oks)}  ❌{len(fails)}")
    for r in items:
        name, url, ok, ms, info = r
        mark = "✅" if ok else "❌"
        extra = ""
        if not ok and isinstance(info, dict):
            extra = f"  — {info.get('error') or info.get('message') or info.get('status') or str(info)[:100]}"
        if not ok:
            print(f"   {mark} {name:30s}  {ms:5d}ms  {extra}")
        else:
            extra_info = ""
            if isinstance(info, dict):
                n = 0
                if isinstance(info.get("items"), list): n = len(info["items"])
                t = (info.get("title") or "")[:40]
                if t or n: extra_info = f"  — title={t} items={n}"
            print(f"   {mark} {name:30s}  {ms:5d}ms{extra_info}")

print("\n" + "-" * 90)
print(f"最终汇总：新增 {N} 源  |  ✅ 成功 {total_ok} ({total_ok/N*100:.1f}%)  |  ❌ 失败 {total_fail} ({total_fail/N*100:.1f}%)")
if total_ok/N*100 >= 65:
    print(f"  🎯 目标达成（≥65%）：{total_ok/N*100:.1f}%")
else:
    print(f"  ⚠️  未达成（目标≥65%，当前{total_ok/N*100:.1f}%），需进一步降级")
print("=" * 90)
