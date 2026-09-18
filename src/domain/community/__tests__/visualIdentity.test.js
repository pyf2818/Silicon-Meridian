import { describe, expect, it } from 'vitest';
import { avatarColor, coverBackground, coverWord, pickCoverPalette, stripMarkdown } from '../visualIdentity.js';

describe('visualIdentity（B2 封面/头像纯逻辑）', () => {
  it('同 id 恒定、不同 id 分散到多组调色板', () => {
    expect(coverBackground('a1')).toBe(coverBackground('a1'));
    const used = new Set(Array.from({ length: 40 }, (_, i) => pickCoverPalette(`post-${i}`).from));
    expect(used.size).toBeGreaterThan(2);
  });

  it('coverWord：取标题前 4 字，空标题回落「川」', () => {
    expect(coverWord('Qwen3-Max 深度测评')).toBe('Qwen');
    expect(coverWord('  ')).toBe('川');
    expect(coverWord(null)).toBe('川');
  });

  it('avatarColor：同名恒定、落在 8 色盘内', () => {
    expect(avatarColor('安安')).toBe(avatarColor('安安'));
    expect(avatarColor('')).toBe(avatarColor(null));
    const sample = Array.from({ length: 24 }, (_, i) => avatarColor(`user-${i}`));
    for (const color of sample) expect(color).toMatch(/^#/);
  });

  it('stripMarkdown 与服务端 extractSummary 规则一致', () => {
    expect(stripMarkdown('# 标题\n\n正文 [链接](https://x) 和 ![图](https://y.png)')).not.toContain('https://y.png');
    expect(stripMarkdown('```js\nconst a=1\n```')).toContain('［代码］');
  });
});
