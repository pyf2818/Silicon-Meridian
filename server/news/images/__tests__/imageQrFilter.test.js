import { describe, expect, it } from 'vitest';
import { extractImageUrl, extractImageUrls, isGoodImageUrl, isQrCodeLike } from '../imageProcessing.js';
import { normalizeItem } from '../../parsing/feedParser.js';

/** 任务 1：资讯图片提取增强——二维码过滤 + 多图图廊 */

const SOURCE = { name: '测试源', url: 'https://example.com', region: 'global', defaultCategory: 'ai' };

describe('isQrCodeLike 二维码过滤', () => {
  it('url 含二维码接口特征 → 过滤', () => {
    expect(isQrCodeLike('https://mp.weixin.qq.com/mp/showqrcode?ticket=abc')).toBe(true);
    expect(isQrCodeLike('https://example.com/qr-code/generate.png')).toBe(true);
    expect(isQrCodeLike('https://example.com/wxa-qr.jpg')).toBe(true);
    expect(isQrCodeLike('https://example.com/img/erweima/qrcode.png')).toBe(true);
  });

  it('alt/周边文案含扫码引导 → 过滤', () => {
    const context = '<img src="https://example.com/a.png" alt="扫码关注公众号">';
    expect(isQrCodeLike('https://example.com/a.png', context)).toBe(true);
    expect(isQrCodeLike('https://example.com/b.png', '<p>长按识别二维码加入群聊</p><img src="https://example.com/b.png">')).toBe(true);
  });

  it('正常内容图不误伤', () => {
    expect(isQrCodeLike('https://example.com/wp-content/uploads/2026/model-arch.png')).toBe(false);
    expect(isQrCodeLike('https://example.com/screenshots/demo-interface.png', '<img src="..." alt="产品界面截图">')).toBe(false);
  });

  it('isGoodImageUrl 拒绝二维码图', () => {
    expect(isGoodImageUrl('https://example.com/qrcode.png', '')).toBe(false);
    expect(isGoodImageUrl('https://example.com/content/hero.png', '')).toBe(true);
  });
});

describe('extractImageUrls 多图提取', () => {
  const html = [
    '<img src="https://example.com/images/cover-main.png" width="1200" height="600">',
    '<img src="https://example.com/images/chart-result.png" width="900" height="500">',
    '<img src="https://example.com/qrcode.png" alt="扫码关注">',
    '<img src="https://example.com/images/logo.png" width="60" height="60">',
  ].join('\n');

  it('返回多张有效图且过滤二维码/logo 小图', () => {
    const urls = extractImageUrls('<item></item>', html, 3);
    expect(urls.length).toBeGreaterThanOrEqual(1);
    expect(urls.length).toBeLessThanOrEqual(3);
    expect(urls.some(url => /qrcode|logo/i.test(url))).toBe(false);
  });

  it('extractImageUrl 兼容取首图', () => {
    expect(extractImageUrl('<item></item>', html)).toBe(extractImageUrls('<item></item>', html, 1)[0]);
  });

  it('无有效图返回空串/空数组', () => {
    expect(extractImageUrl('<item></item>', '<img src="https://example.com/qrcode.png">')).toBe('');
    expect(extractImageUrls('<item></item>', '')).toEqual([]);
  });
});

describe('feedParser 输出 images 数组', () => {
  const xml = `<item>
    <title>某模型发布新版本</title>
    <link>https://example.com/news/1</link>
    <description>新模型发布，附架构图与实测截图。</description>
    <content:encoded><p><img src="https://example.com/images/main-shot.png" width="1200" height="630"><img src="https://example.com/images/bench.png" width="900" height="500"></p></content:encoded>
  </item>`;

  it('item 携带 images（首图与 imageUrl 一致）', () => {
    const item = normalizeItem(xml, SOURCE, 0);
    expect(item.imageUrl).toBeTruthy();
    expect(Array.isArray(item.images)).toBe(true);
    expect(item.images[0]).toBe(item.imageUrl);
    expect(item.images.length).toBeGreaterThanOrEqual(1);
  });
});
