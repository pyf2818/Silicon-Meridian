import urllib.request, urllib.parse, ssl, json, time

ssl._create_default_https_context = ssl._create_unverified_context
BASE = "http://localhost:5176"
TIMEOUT = 12

# 阶段3：探测 1) 哪些RSSHub实例在本机能通；2) 哪些境外/境内源可直连；3) 哪些国内RSSHub路由稳定
RSSHUB_CANDIDATES = [
    "https://rsshub.rssforever.com",
    "https://rsshub.app",
    "https://rss.inshs.xyz",
    "https://rsshub.feeded.xyz",
    "https://rsshub.2019forest.com",
]
# 用一个极快的路由测试 ping
TEST_ROUTE = "/zhihu/hotlist"
print("=== Step 1: RSSHub 实例探测 ===")
for base in RSSHUB_CANDIDATES:
    t0 = time.time()
    try:
        url = base + TEST_ROUTE
        with urllib.request.urlopen(url, timeout=TIMEOUT) as r:
            body = r.read(4096).decode("utf-8", "ignore")
            ok = "<rss" in body or "<feed" in body
            ms = int((time.time()-t0)*1000)
            print(f"  {'✅' if ok else '❌'} {base:40s} {ms:5d}ms rss={ok}")
    except Exception as e:
        ms = int((time.time()-t0)*1000)
        print(f"  ❌ {base:40s} {ms:5d}ms  {str(e)[:80]}")

# 阶段 2：直接探测候选 URL（不经过verify接口，纯本机可达性）
# 这些是constants里旧版和新版都有的源，实际dev server已经有 success的，拿来测试直连
DIRECT_TESTS = [
    # 国内社区（从启动日志看已 Success）
    ("量子位", "https://www.qbitai.com/rss/"),
    ("36氪", "https://www.36kr.com/feed"),
    ("InfoQ中文", "https://www.infoq.cn/feed"),
    ("虎嗅", "https://www.huxiu.com/rss/0.xml"),
    ("钛媒体", "https://www.tmtpost.com/rss.xml"),
    ("少数派", "https://sspai.com/feed"),
    ("爱范儿", "https://www.ifanr.com/feed"),
    ("Solidot", "https://www.solidot.org/index.rss"),
    ("开源中国", "https://www.oschina.net/news/rss"),
    ("IT之家", "https://www.ithome.com/rss"),
    ("阮一峰", "https://www.ruanyifeng.com/blog/atom.xml"),
    ("酷壳", "https://coolshell.cn/feed"),
    ("观察者网", "https://www.guancha.cn/rss"),
    ("经济观察网", "https://www.eeo.com.cn/rss.xml"),
    ("人民网财经", "https://www.people.com.cn/rss/finance.xml"),
    ("中国新闻网财经", "https://www.chinanews.com/rss/finance.xml"),
    # 国内官方
    ("中国政府网", "http://www.gov.cn/rss/govall.xml"),
    ("中国政府网政策", "http://www.gov.cn/rss/zhengce.xml"),
    ("中国政府网要闻", "http://www.gov.cn/rss/yaowen.xml"),
    ("人民网时政", "http://www.people.com.cn/rss/politics.xml"),
    ("新华网时政", "http://www.xinhuanet.com/politics/news_politics.xml"),
    ("中国科学院要闻", "http://www.cas.cn/yw/tt.xml"),
    # 境外（已知在dev server能通的）
    ("TechCrunch", "https://techcrunch.com/feed/"),
    ("The Verge", "https://www.theverge.com/rss/index.xml"),
    ("Wired", "https://www.wired.com/feed/rss"),
    ("Ars Technica", "https://feeds.arstechnica.com/arstechnica/index"),
    ("MIT Technology Review", "https://www.technologyreview.com/feed/"),
    ("BBC Tech", "https://feeds.bbci.co.uk/news/technology/rss.xml"),
    ("Reuters Business", "https://www.reuters.com/business/feed/"),
    ("Reuters TopNews", "https://feeds.reuters.com/reuters/topNews"),
    ("CNBC", "https://www.cnbc.com/id/100003114/device/rss/rss.xml"),
    ("Databricks Blog", "https://www.databricks.com/feed"),
    ("CNCF Blog", "https://www.cncf.io/blog/feed/"),
    ("K8s Blog", "https://kubernetes.io/feed.xml"),
    ("Terraform/Hashicorp Blog", "https://www.hashicorp.com/blog/feed.xml"),
    ("AWS ML Blog", "https://aws.amazon.com/blogs/machine-learning/feed/"),
    ("Azure Blog", "https://azure.microsoft.com/en-us/blog/feed/"),
    ("Google AI Blog", "https://ai.googleblog.com/feeds/posts/default"),
    ("OpenAI Blog", "https://openai.com/blog/rss.xml"),
    ("Meta AI", "https://ai.meta.com/blog/feed/"),
    ("NVIDIA Blog", "https://feeds.nvidianews.com/NVIDIABlog"),
    ("Nvidia Developer", "https://developer.nvidia.com/blog/feed/"),
    ("IBM Research", "https://research.ibm.com/blog/rss.xml"),
    ("Red Hat Blog", "https://www.redhat.com/en/blog/rss.xml"),
    ("Google Cloud Blog", "https://cloud.google.com/blog/feed?lang=en"),
    ("Oracle AI/ML Blog", "https://blogs.oracle.com/ai-and-datascience/rss"),
    ("Hugging Face Blog", "https://huggingface.co/blog/feed.xml"),
    ("LangChain Blog", "https://blog.langchain.dev/rss/"),
    ("LlamaIndex Blog", "https://www.llamaindex.ai/blog/rss"),
    ("Pinecone Blog", "https://www.pinecone.io/learn/feed/"),
    ("Weights & Biases", "https://wandb.ai/frontend/rss/site_blog.xml"),
    ("Sequoia Capital", "https://www.sequoiacap.com/rss"),
    ("YC Blog", "https://blog.ycombinator.com/feed/"),
    ("CB Insights", "https://www.cbinsights.com/feed/"),
    ("a16z", "https://a16z.com/feed/"),
    ("Simon Willison", "https://simonwillison.net/atom/entries/"),
    ("Quanta Magazine", "https://www.quantamagazine.org/feed/"),
    ("Nature", "https://www.nature.com/nature.rss"),
    ("Science Magazine", "https://www.science.org/rss/news/sciencenow.xml"),
    ("MIT News", "https://news.mit.edu/rss/feed"),
    ("ZDNet", "https://www.zdnet.com/news/rss.xml"),
    ("CNET", "https://www.cnet.com/rss/news/"),
    ("Engadget", "https://www.engadget.com/rss.xml"),
    ("Dev.to", "https://dev.to/feed"),
    ("Hacker News Front Page", "https://hnrss.org/frontpage"),
    ("LWN.net", "https://lwn.net/headlines/rss"),
    ("Phoronix", "https://www.phoronix.com/rss.php"),
    ("Smashing Magazine", "https://www.smashingmagazine.com/feed/"),
    # AI 安全/政策类
    ("Partnership on AI", "https://www.partnershiponai.org/feed/"),
    ("Future of Life Institute", "https://futureoflife.org/feed/"),
    ("Center for AI Safety", "https://www.safe.ai/blog/rss.xml"),
    ("EFF Deeplinks", "https://www.eff.org/rss/updates.xml"),
]
print("\n=== Step 2: 本机直连可达性探测 ===")
ok_list = []
fail_list = []
for n, u in DIRECT_TESTS:
    t0 = time.time()
    try:
        req = urllib.request.Request(u, headers={"User-Agent":"Mozilla/5.0 (compatible; Meridian/1.0)"})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            body = r.read(4096).decode("utf-8", "ignore")
            ok = ("<rss" in body) or ("<feed" in body) or ("<rdf:RDF" in body)
            has_items = ("<item" in body) or ("<entry" in body)
            ms = int((time.time()-t0)*1000)
            total_ok = ok or has_items or (r.status == 200 and ok)
            mark = "✅" if total_ok else "⚠"
            if total_ok:
                ok_list.append((n, u, ms))
            else:
                fail_list.append((n, u, ms, f"status={r.status} rss={ok} items={has_items}"))
            print(f"  {mark} {n:28s}  {ms:5d}ms")
    except Exception as e:
        ms = int((time.time()-t0)*1000)
        fail_list.append((n, u, ms, str(e)[:120]))
        print(f"  ❌ {n:28s}  {ms:5d}ms  {str(e)[:80]}")

print(f"\n✅ 直连可达: {len(ok_list)} 个")
for n, u, ms in ok_list:
    print(f"    {n}: {u}")
print(f"\n❌ 不可达: {len(fail_list)} 个")
for n, u, ms, err in fail_list:
    print(f"    {n}: {err}")
