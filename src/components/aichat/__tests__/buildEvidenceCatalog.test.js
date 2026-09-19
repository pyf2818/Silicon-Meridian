import { describe, it, expect } from 'vitest';
import {
  buildEvidenceCatalog,
  catalogNewsLine,
  catalogMaterialLine,
  catalogFileLine,
  CATALOG_LIMITS,
  CATALOG_USAGE_HINT,
} from '../buildEvidenceCatalog.js';

// 目录层的目标：让 agent 看见全貌（几十条），但体积固定可控（正文一律按需取）。
// 这里锁死两件事：① 单行必须是「一行一条」的紧凑格式 ② 总体积显著小于旧的正文注入。

const newsItem = (over = {}) => ({
  id: 'intel-event-1',
  title: 'OpenAI 发布新模型',
  source: 'OpenAI Blog',
  publishedAt: '2026-09-19T10:30:00.000Z',
  category: 'ai-models',
  summary: 'x'.repeat(600),
  ...over,
});

describe('目录行格式（紧凑、一行一条）', () => {
  it('资讯行含 ID / 标题 / 来源 / 时间 / 分类，且不含正文摘要', () => {
    const line = catalogNewsLine(newsItem());
    expect(line).toContain('[资讯:intel-event-1]');
    expect(line).toContain('OpenAI 发布新模型');
    expect(line).toContain('OpenAI Blog');
    expect(line).toContain('ai-models');
    expect(line).not.toContain('x'.repeat(50)); // 摘要不进目录
    expect(line.split('\n').length).toBe(1);
  });

  it('超长标题被截断', () => {
    const line = catalogNewsLine(newsItem({ title: '标'.repeat(200) }));
    expect(line.length).toBeLessThan(120);
    expect(line).toContain('…');
  });

  it('时间缺失时不出现 undefined / NaN', () => {
    const line = catalogNewsLine(newsItem({ publishedAt: 'not-a-date' }));
    expect(line).not.toContain('undefined');
    expect(line).not.toContain('NaN');
  });

  it('素材行与文件行格式', () => {
    expect(catalogMaterialLine({ id: 'm1', title: '研究笔记', source: 'AI 精灵', tags: ['AI', '投资'] }, 0))
      .toBe('[素材:m1] 研究笔记｜AI 精灵｜AI/投资');
    expect(catalogFileLine({ name: 'notes.md', content: 'y'.repeat(500) }))
      .toContain('[文件:notes.md]');
  });
});

describe('buildEvidenceCatalog（条数与体积上限）', () => {
  const many = (n, make) => Array.from({ length: n }, (_, i) => make(i));

  it('资讯条数受 CATALOG_LIMITS.news 限制', () => {
    const c = buildEvidenceCatalog({
      items: many(200, i => newsItem({ id: `id-${i}`, title: `标题${i}` })),
    });
    expect(c.counts.news).toBe(CATALOG_LIMITS.news);
    expect(c.lines.length).toBe(CATALOG_LIMITS.news);
  });

  it('素材/文件条数各自受限', () => {
    const c = buildEvidenceCatalog({
      materials: many(50, i => ({ id: `m${i}`, title: `素材${i}` })),
      files: many(50, i => ({ name: `f${i}.md`, content: 'z' })),
    });
    expect(c.counts.materials).toBe(CATALOG_LIMITS.materials);
    expect(c.counts.files).toBe(CATALOG_LIMITS.files);
  });

  it('【体积回归】满量目录的字符数远小于旧的 12 条 × 600 字正文注入', () => {
    const c = buildEvidenceCatalog({
      items: many(CATALOG_LIMITS.news, i => newsItem({ id: `id-${i}`, title: `这是一条正常长度的资讯标题${i}`, summary: 'x'.repeat(600) })),
      materials: many(CATALOG_LIMITS.materials, i => ({ id: `m${i}`, title: `素材标题${i}` })),
      files: many(CATALOG_LIMITS.files, i => ({ name: `file-${i}.md`, content: 'y'.repeat(1500) })),
    });
    // 旧方案：12×600（证据）+ 6×900（素材）+ 文件 1500 ≈ 14000+ 字符，但只覆盖约 20 条；
    // 目录方案：84 条 ≈ 4.9K 字符（不到旧方案一半，条目数却是 4 倍以上），
    // 且单行必须紧凑——单条超过 70 字符就说明目录里混进了正文。
    expect(c.approxChars).toBeLessThan(7000);
    expect(c.approxChars / c.counts.total).toBeLessThan(70);
    expect(c.counts.total).toBeGreaterThan(12 * 4);
  });

  it('空输入安全', () => {
    const c = buildEvidenceCatalog({});
    expect(c.text).toBe('');
    expect(c.counts.total).toBe(0);
  });

  it('自定义上限生效', () => {
    const c = buildEvidenceCatalog({ items: many(10, i => newsItem({ id: `i${i}` })), limits: { news: 3 } });
    expect(c.counts.news).toBe(3);
  });
});

describe('目录使用说明', () => {
  it('指引 agent 用工具取正文，并强调引用而非复述', () => {
    expect(CATALOG_USAGE_HINT).toContain('目录');
    expect(CATALOG_USAGE_HINT).toContain('search_news');
    expect(CATALOG_USAGE_HINT).toContain('read_intelligence_focus');
    expect(CATALOG_USAGE_HINT).toContain('read_workspace_file');
    expect(CATALOG_USAGE_HINT).toContain('[资讯:ID]');
  });
});
