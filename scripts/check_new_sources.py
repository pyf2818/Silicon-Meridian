import urllib.request
import urllib.parse
import json
import time
import ssl
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

ssl._create_default_https_context = ssl._create_unverified_context

BASE = "http://localhost:5176"
TIMEOUT = 18  # 每个verify超时

# 62个新增源（按P0/P1分组）
SOURCES = {
    "【P0 国际标准/监管】": [
        "ISO News|https://www.iso.org/news/rss.xml",
        "IEC News|https://www.iec.ch/newsroom/rss",
        "IEEE Standards|https://standards.ieee.org/blog/feed/",
        "OECD Science|https://www.oecd.org/science/rss.xml",
        "EU AI Office|https://digital-strategy.ec.europa.eu/en/news/rss",
        "White House OSTP|https://www.whitehouse.gov/ostp/feed/",
    ],
    "【P0 中国官方权威】": [
        "国务院新闻办|https://rsshub.rssforever.com/gov/scio/xwfb",
        "国家发改委|https://rsshub.rssforever.com/gov/ndrc/gyjj",
        "国家网信办|https://rsshub.rssforever.com/gov/cac/xwzx",
        "国家标准化管理委员会|https://rsshub.rssforever.com/gov/sac",
        "中国科学院|https://rsshub.rssforever.com/cas/kyjz",
        "中国工程院|https://rsshub.rssforever.com/cae/xsdt",
        "中国科协|https://rsshub.rssforever.com/gov/cast/xwbd",
        "国家人工智能标椎总体组|https://www.aii-alliance.org/rss",
        "中国人工智能学会 CAAI|https://www.caai.cn/rss",
        "中国计算机学会 CCF|https://rsshub.rssforever.com/ccf/news",
        "智源研究院 BAAI|https://www.baai.ac.cn/rss",
        "之江实验室|https://www.zhejianglab.com/rss",
        "上海人工智能实验室|https://www.shlab.org.cn/rss",
    ],
    "【P0 海外AI独角兽/厂商】": [
        "xAI Blog|https://x.ai/blog/rss.xml",
        "Groq Blog|https://groq.com/blog/rss",
        "Databricks Blog|https://www.databricks.com/blog/feed",
        "Perplexity Blog|https://blog.perplexity.ai/rss",
        "Character.AI News|https://character.ai/blog/rss",
        "Inflection AI News|https://inflection.ai/blog/rss",
        "Replicate Blog|https://replicate.com/blog/feed",
        "Together AI Blog|https://www.together.ai/blog/rss",
        "Fireworks AI Blog|https://fireworks.ai/blog/rss",
        "Modal Blog|https://modal.com/blog/rss",
        "Cerebras Blog|https://www.cerebras.net/blog/rss",
        "Tenstorrent Blog|https://tenstorrent.com/blog/rss",
    ],
    "【P0 国内AI大厂/实验室】": [
        "百度研究院|https://research.baidu.com/rss",
        "飞桨 PaddlePaddle|https://www.paddlepaddle.org.cn/rss",
        "阿里达摩院|https://damo.alibaba.com/rss",
        "通义实验室|https://tongyi.aliyun.com/rss",
        "火山引擎 AI|https://www.volcengine.com/ai/rss",
        "腾讯混元|https://hunyuan.tencent.com/rss",
        "腾讯优图实验室|https://youtu.qq.com/rss",
        "华为诺亚方舟实验室|https://www.noahlab.com.hk/rss",
        "昇腾社区|https://www.hiascend.com/rss",
        "讯飞研究院|https://research.xfyun.cn/rss",
        "商汤 SenseTime|https://www.sensetime.com/rss",
        "旷视 Megvii|https://www.megvii.com/rss",
        "MiniMax 稀宇|https://www.minimaxi.com/rss",
        "阶跃星辰 StepFun|https://stepfun.com/rss",
        "零一万物|https://www.lingyiwanwu.com/rss",
        "月之暗面 Moonshot|https://www.moonshot.cn/rss",
        "百川智能 Baichuan|https://www.baichuan-ai.com/rss",
        "深言科技 DeepLang|https://www.deeplang.ai/rss",
    ],
    "【P1 产业联盟/专业媒体】": [
        "AI Alliance|https://thealliance.ai/news/rss",
        "Partnership on AI|https://www.partnershiponai.org/feed/",
        "SemiAnalysis|https://semianalysis.com/feed/",
        "The Next Platform|https://www.nextplatform.com/feed/",
        "WikiChip Fuse|https://fuse.wikichip.org/feed/",
        "半导体行业观察|https://rsshub.rssforever.com/jiweixin",
        "CNCF Blog|https://www.cncf.io/blog/feed/",
        "Kubernetes Blog|https://kubernetes.io/blog/feed/",
        "Terraform Blog|https://www.hashicorp.com/blog/feed.xml",
        "CB Insights Research|https://www.cbinsights.com/feed/",
        "PitchBook News|https://pitchbook.com/news/feed",
        "a16z AI & Tech|https://a16z.com/category/ai/feed/",
        "Sequoia Capital Blog|https://www.sequoiacap.com/rss",
    ],
}

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
                data = {"ok": False, "raw": body[:200]}
            ms = int((time.time() - t0) * 1000)
            ok = bool(data.get("ok") or data.get("valid") or (isinstance(data, dict) and data.get("title")))
            # 还看response code 200+非空body也算ok
            if not ok and (data.get("status") == 200 or r.status == 200):
                if data.get("title") or data.get("items") or data.get("feedType"):
                    ok = True
            return (name, url, ok, ms, data)
    except Exception as e:
        ms = int((time.time() - t0) * 1000)
        return (name, url, False, ms, {"error": str(e)[:200]})

def main():
    # 先探测BASE是否存活
    try:
        urllib.request.urlopen(BASE + "/", timeout=5)
        print(f"[OK] dev server alive: {BASE}")
    except Exception as e:
        print(f"[FATAL] 无法连接dev server {BASE}: {e}")
        print("请先执行 npm run dev 启动服务")
        return

    all_flat = []
    for grp, items in SOURCES.items():
        for i in items:
            n, u = i.split("|", 1)
            all_flat.append((grp, n, u))

    print(f"[INFO] 开始检测 {len(all_flat)} 个新增源，并发 8，单源超时 {TIMEOUT}s ...\n")

    results = {}  # grp -> list of tuples
    for grp in SOURCES:
        results[grp] = []

    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = {}
        for grp, n, u in all_flat:
            fut = ex.submit(verify, n, u)
            futs[fut] = (grp, n)
        done = 0
        for fut in as_completed(futs):
            grp, n = futs[fut]
            try:
                r = fut.result()
            except Exception as e:
                r = (n, None, False, 0, {"error": str(e)})
            results[grp].append(r)
            done += 1
            status = "✅" if r[2] else "❌"
            ms = r[3]
            print(f"  [{done:02d}/{len(all_flat)}] {status} {r[0]}  {ms}ms")

    # 汇总
    total_ok = 0
    total_fail = 0
    print("\n" + "=" * 78)
    print("  连通性检测报告（调用 /api/verify-source 验证）")
    print("=" * 78)
    for grp, items in results.items():
        oks = [x for x in items if x[2]]
        fails = [x for x in items if not x[2]]
        total_ok += len(oks)
        total_fail += len(fails)
        print(f"\n{grp}  ✅{len(oks)}  ❌{len(fails)}")
        for r in items:
            name, url, ok, ms, info = r
            mark = "✅" if ok else "❌"
            extra = ""
            if not ok:
                if isinstance(info, dict):
                    extra = f"  — {info.get('error') or info.get('message') or json.dumps(info, ensure_ascii=False)[:120]}"
                else:
                    extra = f"  — {info}"
            print(f"   {mark} {name:22s}  {ms:5d}ms  {url}{extra}")

    print("\n" + "-" * 78)
    print(f"汇总：  新增 {len(all_flat)} 源  |  ✅ 成功 {total_ok} ({total_ok/len(all_flat)*100:.1f}%)  |  ❌ 失败 {total_fail} ({total_fail/len(all_flat)*100:.1f}%)")
    print("=" * 78)

if __name__ == "__main__":
    main()
