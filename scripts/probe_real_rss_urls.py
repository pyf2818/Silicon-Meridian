import urllib.request, urllib.parse, ssl, json, time
ssl._create_default_https_context = ssl._create_unverified_context

# 1. 测试常用RSSHub公共实例
instances = [
    ("rssforever", "https://rsshub.rssforever.com"),
    ("rsshub app",    "https://rsshub.app"),
    ("inshs",         "https://rss.inshs.xyz"),
    ("10101",         "https://rsshub.10101.io"),
    ("noob",          "https://rsshub.noob.tw"),
]
probe_paths = [
    # 已知比较简单的path
    ("/simple-sitemap-parser?url=sciencenet.cn&sitemap=false", "sitemap-parser"),
    ("/weibo/search/hot", "weibo hot"),
    ("/jiweixin", "集微网"),
    ("/xiaohongshu/hot", "xiaohongshu"),
    ("/sspai/matrix", "少数派"),
]
print("=" * 60)
print("[1] RSSHub实例探测 (每个 3s timeout)")
print("=" * 60)
for i_name, i_host in instances:
    fastest = 9999
    ok_count = 0
    for p, _ in probe_paths[:3]:
        url = i_host + p
        t0 = time.time()
        try:
            r = urllib.request.urlopen(url, timeout=3)
            ms = int((time.time() - t0) * 1000)
            fastest = min(fastest, ms)
            ok_count += 1
        except Exception as e:
            pass
    print(f"  {i_name:12s} -> {ok_count}/3 ok   best={fastest if fastest<9999 else 'TIMEOUT'}ms    {i_host}")

# 2. 逐源探测真实RSS URL（先处理海外最核心的几批）
print("\n" + "=" * 60)
print("[2] 海外源真实RSS探测（直接 fetch+解析META中的rss link）")
print("=" * 60)

candidates = {
    # name: list of candidate URLs (RSS or homepage that may have <link rel=alternate>)
    "xAI Blog": [
        "https://x.ai/blog/rss.xml",
        "https://x.ai/blog/feed.xml",
        "https://x.ai/feed",
        "https://x.ai/rss",
    ],
    "Groq Blog": [
        "https://groq.com/blog/rss",
        "https://groq.com/feed",
        "https://groq.com/blog/feed/",
        "https://blog.groq.com/feed/",
        "https://newsroom.groq.com/feed/",
    ],
    "Databricks": [
        "https://www.databricks.com/blog/feed",
        "https://www.databricks.com/blog.rss",
        "https://www.databricks.com/feed",
    ],
    "Replicate": [
        "https://replicate.com/blog/feed",
        "https://replicate.com/blog.rss",
        "https://replicate.com/changelog.rss",
    ],
    "Modal": [
        "https://modal.com/blog/rss",
        "https://modal.com/blog/feed.xml",
        "https://modal.com/feed",
    ],
    "Cerebras": [
        "https://www.cerebras.net/blog/rss",
        "https://www.cerebras.net/blog/feed/",
        "https://www.cerebras.net/feed/",
    ],
    "Tenstorrent": [
        "https://tenstorrent.com/blog/rss",
        "https://tenstorrent.com/blog/feed/",
        "https://tenstorrent.com/feed/",
    ],
    "Perplexity": [
        "https://blog.perplexity.ai/rss",
        "https://blog.perplexity.ai/feed",
        "https://www.perplexity.ai/rss",
    ],
    "Character.AI": [
        "https://character.ai/blog/rss",
        "https://character.ai/blog/feed",
    ],
    "Inflection": [
        "https://inflection.ai/blog/rss",
        "https://inflection.ai/blog/feed",
        "https://www.inflection.ai/feed",
    ],
    "Together AI": [
        "https://www.together.ai/blog/rss",
        "https://www.together.ai/blog/feed",
        "https://together.ai/blog.rss",
    ],
    "Fireworks AI": [
        "https://fireworks.ai/blog/rss",
        "https://fireworks.ai/blog/feed",
        "https://fireworks.ai/rss",
        "https://blog.fireworks.ai/feed",
    ],
    "PitchBook": [
        "https://pitchbook.com/news/feed",
        "https://pitchbook.com/feed",
    ],
    "CB Insights": [
        "https://www.cbinsights.com/feed/",
        "https://www.cbinsights.com/research/feed/",
    ],
    "SemiAnalysis": [
        "https://semianalysis.com/feed/",
        "https://semianalysis.substack.com/feed",
    ],
    "NextPlatform": [
        "https://www.nextplatform.com/feed/",
        "https://www.nextplatform.com/feed",
    ],
    "WikiChip": [
        "https://fuse.wikichip.org/feed/",
        "https://fuse.wikichip.org/news/feed/",
    ],
    "a16z AI": [
        "https://a16z.com/category/ai/feed/",
        "https://a16z.com/ai/rss",
        "https://a16z.com/feed/",
    ],
    "Kubernetes Blog": [
        "https://kubernetes.io/blog/feed/",
        "https://kubernetes.io/feed.xml",
        "https://kubernetes.io/blog/index.xml",
    ],
    "AI Alliance": [
        "https://thealliance.ai/news/rss",
        "https://thealliance.ai/feed",
        "https://thealliance.ai/rss",
    ],
    "ISO News": [
        "https://www.iso.org/news/rss.xml",
        "https://www.iso.org/rss.xml",
        "https://www.iso.org/feeds/news.xml",
    ],
    "IEC News": [
        "https://www.iec.ch/newsroom/rss",
        "https://www.iec.ch/rss",
    ],
    "IEEE Standards": [
        "https://standards.ieee.org/blog/feed/",
        "https://standards.ieee.org/feed/",
        "https://blog.ieee.org/feed/",
    ],
    "OECD Science": [
        "https://www.oecd.org/science/rss.xml",
        "https://www.oecd.org/rss/science.xml",
    ],
    "WH OSTP": [
        "https://www.whitehouse.gov/ostp/feed/",
        "https://www.whitehouse.gov/feed/",
        "https://www.whitehouse.gov/blog/feed/",
    ],
    "EU AI Office": [
        "https://digital-strategy.ec.europa.eu/en/news/rss",
        "https://digital-strategy.ec.europa.eu/en/rss",
    ],
    "Sequoia": [
        "https://www.sequoiacap.com/rss",
        "https://www.sequoiacap.com/articles/rss",
    ],
    "CNCF": [
        "https://www.cncf.io/blog/feed/",
    ],
    "Terraform": [
        "https://www.hashicorp.com/blog/feed.xml",
    ],
    "Partnership on AI": [
        "https://www.partnershiponai.org/feed/",
    ],
    "百度研究院": [
        "https://research.baidu.com/rss",
        "https://research.baidu.com/feed.xml",
    ],
    "飞桨": [
        "https://www.paddlepaddle.org.cn/rss",
        "https://www.paddlepaddle.org.cn/feed",
    ],
    "阿里达摩院": [
        "https://damo.alibaba.com/rss",
        "https://damo.alibaba.com/feed",
    ],
    "智源BAAI": [
        "https://www.baai.ac.cn/rss",
        "https://www.baai.ac.cn/feed",
    ],
    "之江实验室": [
        "https://www.zhejianglab.com/rss",
        "https://www.zhejianglab.com/feed",
    ],
    "上海AI Lab": [
        "https://www.shlab.org.cn/rss",
    ],
    "腾讯混元": [
        "https://hunyuan.tencent.com/rss",
    ],
    "腾讯优图": [
        "https://youtu.qq.com/rss",
    ],
    "火山AI": [
        "https://www.volcengine.com/ai/rss",
    ],
    "讯飞研究院": [
        "https://research.xfyun.cn/rss",
    ],
    "昇腾": [
        "https://www.hiascend.com/rss",
    ],
    "商汤": [
        "https://www.sensetime.com/rss",
    ],
    "旷视": [
        "https://www.megvii.com/rss",
    ],
    "MiniMax": [
        "https://www.minimaxi.com/rss",
    ],
    "StepFun": [
        "https://stepfun.com/rss",
    ],
    "Moonshot": [
        "https://www.moonshot.cn/rss",
    ],
    "零一万物": [
        "https://www.lingyiwanwu.com/rss",
    ],
    "百川": [
        "https://www.baichuan-ai.com/rss",
    ],
    "DeepLang": [
        "https://www.deeplang.ai/rss",
    ],
    "通义": [
        "https://tongyi.aliyun.com/rss",
    ],
    "华为诺亚": [
        "https://www.noahlab.com.hk/rss",
    ],
    "CAAI": [
        "https://www.caai.cn/rss",
    ],
    "AI标准总体组": [
        "https://www.aii-alliance.org/rss",
    ],
    "a16z": [
        "https://a16z.com/category/ai/feed/",
    ],
}

def test_url(url, timeout=6):
    try:
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}
        req = urllib.request.Request(url, headers=headers)
        t0 = time.time()
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read(1024 * 64)  # 读前64KB
            ms = int((time.time() - t0) * 1000)
            ct = r.headers.get("Content-Type", "")
            text = body.decode("utf-8", "ignore").lower()
            is_rss = ("<rss" in text or "<feed" in text or "<rdf:RDF" in text or "xml" in ct.lower())
            has_items = ("<item" in text or "<entry" in text)
            ok = (r.status == 200) and (is_rss or has_items) and len(body) > 500
            return (ok, ms, ct, f"len={len(body)}")
    except Exception as e:
        return (False, 0, "", str(e)[:80])

results = []
for name, urls in candidates.items():
    found = None
    for u in urls:
        ok, ms, ct, info = test_url(u)
        if ok:
            found = (u, ms, info)
            break
    if found:
        results.append((name, "OK", found[0], f"{found[1]}ms {found[2]}"))
        print(f"  ✅ {name:20s}  {found[0]}")
    else:
        # 最后一条的失败原因
        _, _, _, info = test_url(urls[-1])
        results.append((name, "FAIL", "", info))
        print(f"  ❌ {name:20s}  ({info})")

print("\n[done] 探测完成")
