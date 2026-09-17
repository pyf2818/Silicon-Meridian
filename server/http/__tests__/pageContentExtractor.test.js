import { describe, expect, it } from 'vitest';
import {
  MAX_CONTENT_LENGTH,
  MIN_CONTAINER_TEXT_LENGTH,
  extractMainContent,
  htmlToText,
  stripLinkHeavyBlocks,
  stripNoiseElements,
} from '../pageContentExtractor.js';

/** 去掉标签便于断言（避免标签里的 href 干扰文本匹配） */
const lstrip = html => htmlToText(html);

const LONG_PARAGRAPH = '研究团队表示，新模型在数学推理与代码生成任务上的表现全面超过上一代，并已在官方博客给出基准数据。';

const PAGE_WITH_ARTICLE = `<html><head><title>示例</title>
<script>window.ads = { push() {} };</script>
<style>.ad{color:red}</style>
</head><body>
<nav class="site-nav"><a href="/">首页</a><a href="/about">关于我们</a></nav>
<header class="site-header">站点头部与搜索框</header>
<div class="sidebar"><h3>相关阅读</h3><p>推荐阅读：另一篇文章</p></div>
<article class="post-content">
  <p>OpenAI 今日发布新一代推理模型，官方称在复杂任务上的准确率显著提升。</p>
  <div class="advert"><span>广告位：某产品限时促销，点击购买</span></div>
  <p>${LONG_PARAGRAPH}</p>
</article>
<div class="comment-area">评论区：用户甲说很不错</div>
<footer class="site-footer">版权所有 © 示例站 · 京ICP备000000号</footer>
</body></html>`;

const PAGE_WITHOUT_CONTAINER = `<html><body><div id="root">
<p>一段普通页面文本，没有语义容器，只有零散段落。</p>
<p>第二段内容用于把整页文本凑得足够长，检验退化路径是否仍然可用。</p>
</div></body></html>`;

const PAGE_WITH_CLASS_HINT = `<html><body>
<div class="entry-content"><p>这是一篇使用 entry-content 类名的文章正文，语义容器识别应当命中 class 提示。</p><p>${LONG_PARAGRAPH}</p></div>
</body></html>`;

describe('htmlToText', () => {
  it('去标签 + 解码实体 + 折叠空白', () => {
    expect(htmlToText('<p>OpenAI&nbsp;发布&mdash;新模型</p>\n\n<p>第二段</p>')).toBe('OpenAI 发布—新模型 第二段');
  });

  it('CDATA 与越界实体不炸', () => {
    expect(() => htmlToText('<![CDATA[a]]>&#99999999;')).not.toThrow();
  });
});

describe('stripNoiseElements', () => {
  it('删掉结构性噪声标签（script/style/nav/header/footer）', () => {
    const out = stripNoiseElements(PAGE_WITH_ARTICLE);
    expect(out).not.toContain('window.ads');
    expect(out).not.toContain('站点头部');
    expect(out).not.toContain('版权所有');
  });

  it('删掉 class/id 命中广告与推荐的块', () => {
    const out = stripNoiseElements(PAGE_WITH_ARTICLE);
    expect(out).not.toContain('广告位');
    expect(out).not.toContain('推荐阅读');
    expect(out).not.toContain('评论区');
  });
});

describe('stripLinkHeavyBlocks —— 链接密集块（导航/相关阅读/分享）', () => {
  it('删掉锚文本占大头的块', () => {
    // 注意：块内文本需超过 LINK_DENSITY_MIN_TEXT(40) 才参与判断——太短的块宁可不动
    const html = `<div class="x"><a href="/a">相关阅读一：某公司发布新一代推理模型</a><a href="/b">相关阅读二：行业融资周报第 36 期</a><a href="/c">相关阅读三：监管政策解读与合规指引</a><a href="/d">相关阅读四：开源生态月度观察</a></div>`;
    expect(lstrip(stripLinkHeavyBlocks(html))).not.toContain('相关阅读');
  });

  it('正文段落里偶尔带链接时不误删（保守阈值）', () => {
    const paragraph = `<div>研究团队在论文中给出了详细基准数据，并公开了<a href="/paper">技术报告</a>供同行复现与验证，覆盖数学推理、代码生成与多轮工具调用等多项任务。</div>`;
    expect(lstrip(stripLinkHeavyBlocks(paragraph))).toContain('研究团队在论文中');
  });

  it('短块不做判断（长度兜底）', () => {
    const tiny = `<div><a href="/x">更多</a></div>`;
    expect(stripLinkHeavyBlocks(tiny)).toBe(tiny);
  });
});

describe('extractMainContent —— 主容器抽取（第2点修复）', () => {
  it('有 <article> 时只取容器内的正文，导航/页脚/侧栏/广告全部不在结果里', () => {
    const { content, extraction, strategy } = extractMainContent(PAGE_WITH_ARTICLE);
    expect(extraction).toBe('container');
    expect(strategy).toBe('article');
    expect(content).toContain('OpenAI 今日发布新一代推理模型');
    expect(content).toContain('数学推理与代码生成');
    // 这些都是原先「整页去标签」会混进"正文"的内容
    for (const noise of ['首页', '关于我们', '站点头部', '相关阅读', '广告位', '评论区', '版权所有', 'ICP备']) {
      expect(content).not.toContain(noise);
    }
  });

  it('识别 class 提示型容器（entry-content）', () => {
    const { content, extraction, strategy } = extractMainContent(PAGE_WITH_CLASS_HINT);
    expect(extraction).toBe('container');
    expect(strategy).toBe('class-hint');
    expect(content).toContain('使用 entry-content 类名');
  });

  it('没有可用容器时退化为整页，并如实标记 fallback', () => {
    const { content, extraction, strategy } = extractMainContent(PAGE_WITHOUT_CONTAINER);
    expect(extraction).toBe('fallback');
    expect(strategy).toBe('whole-page');
    expect(content).toContain('没有语义容器');
  });

  it('容器文本过短（低于阈值）也退化为整页，避免抓到一段注脚当正文', () => {
    const tiny = `<html><body><article><p>太短</p></article><div><p>${LONG_PARAGRAPH}</p></div></body></html>`;
    expect(MIN_CONTAINER_TEXT_LENGTH).toBeGreaterThan(3);
    const { extraction } = extractMainContent(tiny);
    expect(extraction).toBe('fallback');
  });

  it('多候选择优：文本最长的容器胜出', () => {
    const html = `<html><body>
      <article class="post-content"><p>短正文</p></article>
      <div class="article-body"><p>${LONG_PARAGRAPH}</p><p>${LONG_PARAGRAPH}</p></div>
    </body></html>`;
    const { content } = extractMainContent(html);
    expect(content).toContain('研究团队表示');
    expect(content).not.toContain('短正文');
  });

  it('正文长度受 MAX_CONTENT_LENGTH 限制', () => {
    const huge = `<html><body><article><p>${'长'.repeat(MAX_CONTENT_LENGTH + 5000)}</p></article></body></html>`;
    expect(extractMainContent(huge).content.length).toBe(MAX_CONTENT_LENGTH);
  });

  it('空 / 非 HTML 输入不抛异常', () => {
    expect(() => extractMainContent('')).not.toThrow();
    expect(extractMainContent('').content).toBe('');
    expect(extractMainContent(null).content).toBe('');
  });
});
