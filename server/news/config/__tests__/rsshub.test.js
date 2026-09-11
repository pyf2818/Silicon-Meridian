import { describe, it, expect, vi, afterEach } from 'vitest';

// RSSHUB_BASE 在模块加载时解析 env——每个用例重置模块后动态导入
async function loadConstants() {
  vi.resetModules();
  return import('../constants.js');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('RSSHub 桥接层（Batch1）', () => {
  it('环境变量为空白时回退默认公共实例', async () => {
    vi.stubEnv('RSSHUB_BASE', '   ');
    const { RSSHUB_BASE } = await loadConstants();
    expect(RSSHUB_BASE).toBe('https://rsshub.rssforever.com');
  });

  it('RSSHUB_BASE 环境变量可指向自建实例（容忍尾部斜杠）', async () => {
    vi.stubEnv('RSSHUB_BASE', 'https://rss.self-hosted.internal/');
    const { RSSHUB_BASE, rsshubUrl } = await loadConstants();
    expect(RSSHUB_BASE).toBe('https://rss.self-hosted.internal');
    expect(rsshubUrl('/aminer/ai')).toBe('https://rss.self-hosted.internal/aminer/ai');
  });

  it('非 http/https 的环境变量回退默认实例', async () => {
    vi.stubEnv('RSSHUB_BASE', 'ftp://nope');
    const { RSSHUB_BASE } = await loadConstants();
    expect(RSSHUB_BASE).toBe('https://rsshub.rssforever.com');
  });

  it('rsshubUrl 自动补齐路由前导斜杠', async () => {
    const { RSSHUB_BASE, rsshubUrl } = await loadConstants();
    expect(rsshubUrl('aminer/ai')).toBe(`${RSSHUB_BASE}/aminer/ai`);
  });

  it('桥接源不变量：全部经实例基址生成，直连源不标记', async () => {
    const { DEFAULT_SOURCES, RSSHUB_BASE, BRIDGED_SOURCE_NAMES } = await loadConstants();
    const bridged = DEFAULT_SOURCES.filter((s) => s?.bridged);
    expect(bridged.length).toBeGreaterThanOrEqual(50);
    for (const s of bridged) {
      expect(s.url.startsWith(`${RSSHUB_BASE}/`)).toBe(true);
      expect(BRIDGED_SOURCE_NAMES.has(s.name)).toBe(true);
      expect(s.url.length).toBeGreaterThan(RSSHUB_BASE.length + 1);
    }
    // 直连源（自有 RSS）不得混入桥接名单
    expect(BRIDGED_SOURCE_NAMES.has('量子位')).toBe(false);
    expect(BRIDGED_SOURCE_NAMES.has('机器之心')).toBe(false);
  });

  it('切换实例基址后所有桥接 URL 整体跟随，不再硬编码域名', async () => {
    vi.stubEnv('RSSHUB_BASE', 'https://mirror.example.com');
    const { DEFAULT_SOURCES } = await loadConstants();
    const bridged = DEFAULT_SOURCES.filter((s) => s?.bridged);
    expect(bridged.length).toBeGreaterThan(0);
    for (const s of bridged) {
      expect(s.url.startsWith('https://mirror.example.com/')).toBe(true);
      expect(s.url).not.toContain('rsshub.rssforever.com');
    }
  });
});
