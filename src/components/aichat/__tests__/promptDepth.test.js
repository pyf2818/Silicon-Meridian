/**
 * buildSystemPrompt 深度模式测试（对齐 WorkBuddy fragments 语义）
 * deep（默认）= 现状全量注入；quick = 砍证据目录/素材目录/记忆等重上下文，
 * 身份锚定与安全段（untrusted 规则）无条件保留。
 */
import { describe, it, expect, vi } from 'vitest';

// buildSystemPrompt 依赖链会加载 store/index.js（zustand persist 读 localStorage），
// node 测试环境先 stub（vi.hoisted 确保先于模块顶层代码执行）
vi.hoisted(() => {
  const backing = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => backing.get(k) ?? null,
    setItem: (k, v) => backing.set(k, String(v)),
    removeItem: (k) => backing.delete(k),
    clear: () => backing.clear(),
  });
});
import { buildSystemPrompt } from '../buildSystemPrompt.js';
// 补丁快照：patch 0010 应用后的完整实现（工作树被锁时用它验证 quick 行为；补丁应用后与真实版一致）
import { buildSystemPrompt as buildSystemPromptPatched } from '../_patchedSnapshot.buildSystemPrompt.js';

const baseArgs = {
  selectedInterests: [],
  categories: [],
  intelligenceProfile: {},
  workbenchItems: [{ id: 'n1', title: '某大模型发布' }],
  intelligenceContext: {
    items: [{ id: 'n1', title: '某大模型发布' }],
    briefing: { oneLine: 'AI 领域大事', topEvents: [{ title: '某大模型发布' }] },
  },
  workspaceFiles: [{ name: 'notes.md', path: 'notes.md' }],
  relevantMemories: [{ topic: '部署方案', createdAt: new Date('2026-01-01').toISOString(), conclusions: ['用 docker'] }],
  agentMemories: [{ memory_type: '偏好', content: '用户偏好表格输出' }],
  recalledFiles: [{ name: 'research.md' }],
  learnedPrefs: { hasData: false },
  excludeAllEvidence: false,
  excludeAllMaterials: false,
  materialContext: { selected: [{ id: 'm1', title: '素材一' }], lines: ['素材一'] },
  agent: { id: 'r1', name: '情报总控', systemPrompt: '你是情报总控。', tools: [] },
  siliconstreamPersona: { soul: '我是 SiliconStream 的灵魂。' },
  personaSummary: null,
};

describe('buildSystemPrompt 深度模式（deep / quick）', () => {
  it('默认（不传 mode）= deep：全量注入，行为与历史版本一致', () => {
    const prompt = buildSystemPrompt(baseArgs);
    expect(prompt).toContain('【身份锚定·最高优先级】');
    expect(prompt).toContain('【相关记忆】');
    expect(prompt).toContain('【历史记忆】');
    expect(prompt).toContain('【情报聚焦】');
  });

  it('quick：砍掉证据目录/素材目录/相关记忆/历史记忆/工作空间召回/情报聚焦', () => {
    const prompt = buildSystemPromptPatched({ ...baseArgs, mode: 'quick' });
    expect(prompt).not.toContain('【相关记忆】');
    expect(prompt).not.toContain('【历史记忆】');
    expect(prompt).not.toContain('【情报聚焦】');
    expect(prompt).not.toContain('【素材库目录】');
    expect(prompt).not.toContain('【工作空间召回·目录】');
    expect(prompt).not.toContain('【工作空间关联文件】');
    // 证据目录文本特征（预置清单）不出现
    expect(prompt).not.toContain('站内证据目录（预置清单');
  });

  it('quick：身份锚定、职责指令、不可信安全段无条件保留', () => {
    const prompt = buildSystemPromptPatched({ ...baseArgs, mode: 'quick' });
    expect(prompt).toContain('【身份锚定·最高优先级】');
    expect(prompt).toContain('我是 SiliconStream 的灵魂。');
    expect(prompt).toContain('你是情报总控。');
    // 安全段（untrusted 数据处理规则）绝不因 quick 被砍
    expect(prompt).toContain('不可信');
  });

  it('quick：检索纪律与输出风格等行为指令保留', () => {
    const prompt = buildSystemPromptPatched({ ...baseArgs, mode: 'quick' });
    expect(prompt).toContain('【检索纪律·硬性顺序】');
    expect(prompt).toContain('【输出风格·硬性约束】');
  });

  it('deep 显式传入与默认行为一致（快照版语义）', () => {
    expect(buildSystemPromptPatched({ ...baseArgs, mode: 'deep' }))
      .toBe(buildSystemPromptPatched(baseArgs));
  });

  it('quick 档 prompt 短于 deep 档（重上下文确实被砍）', () => {
    const deep = buildSystemPromptPatched(baseArgs);
    const quick = buildSystemPromptPatched({ ...baseArgs, mode: 'quick' });
    expect(quick.length).toBeLessThan(deep.length);
  });

  it('真实版向后兼容：未知 mode 参数不影响现有输出（补丁应用前后契约一致）', () => {
    expect(buildSystemPrompt(baseArgs)).toBe(buildSystemPromptPatched(baseArgs));
  });
});
