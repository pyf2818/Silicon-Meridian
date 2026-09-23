/**
 * buildSystemPrompt 身份隔离测试（v26.9）
 * 核心：SiliconStream 灵魂（siliconstreamPersona）与工作站角色（agent）完全隔离——
 * 角色的 persona/soul/voice/habits 不得进入 system prompt，只允许职责指令（systemPrompt）与工具。
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

const siliconstreamPersona = {
  persona: { traits: ['情报敏锐'], background: '万般硅川主控', values: ['可溯源'] },
  soul: '我是 SiliconStream 的灵魂。',
  voice: { tone: '专业而亲和', pace: '紧凑', formality: '适中' },
  habits: ['先给结论'],
};

const workstationRole = {
  id: 'tech-advisor',
  name: '技术顾问',
  systemPrompt: '你是技术领域资深顾问，负责评估技术价值。',
  // 这些字段是角色的灵魂设定——v26.9 起绝不允许进入 SiliconStream 的 prompt
  persona: { traits: ['技术敏感'], background: '前大厂工程师', values: ['工程务实'] },
  soul: '我不追热点，追原理。',
  voice: { tone: '极客范', pace: '快节奏', formality: '随意' },
  habits: ['先讲原理再讲应用'],
  tools: [],
};

const baseArgs = {
  selectedInterests: [],
  categories: [],
  intelligenceProfile: {},
  workbenchItems: [],
  intelligenceContext: null,
  workspaceFiles: [],
  relevantMemories: [],
  agentMemories: [],
  recalledFiles: [],
  learnedPrefs: { hasData: false },
  excludeAllEvidence: true,
  excludeAllMaterials: true,
  materialContext: null,
  personaSummary: null,
};

describe('buildSystemPrompt 身份隔离（v26.9）', () => {
  it('SiliconStream 灵魂进入身份锚定区（persona/soul/voice/habits）', () => {
    const prompt = buildSystemPrompt({ ...baseArgs, agent: workstationRole, siliconstreamPersona });
    expect(prompt).toContain('【身份锚定·最高优先级】');
    expect(prompt).toContain('你是 SiliconStream');
    expect(prompt).toContain('我是 SiliconStream 的灵魂。');
    expect(prompt).toContain('万般硅川主控');
    expect(prompt).toContain('专业而亲和');
    expect(prompt).toContain('先给结论');
  });

  it('工作站角色的 persona/soul/voice/habits 绝不混入 prompt', () => {
    const prompt = buildSystemPrompt({ ...baseArgs, agent: workstationRole, siliconstreamPersona });
    expect(prompt).not.toContain('我不追热点，追原理');
    expect(prompt).not.toContain('技术敏感');
    expect(prompt).not.toContain('前大厂工程师');
    expect(prompt).not.toContain('极客范');
    expect(prompt).not.toContain('先讲原理再讲应用');
  });

  it('工作站角色的职责指令（systemPrompt）正常注入，且声明为职责模式', () => {
    const prompt = buildSystemPrompt({ ...baseArgs, agent: workstationRole, siliconstreamPersona });
    expect(prompt).toContain('你是技术领域资深顾问，负责评估技术价值。');
    expect(prompt).toContain('「技术顾问」专家职责运行');
    expect(prompt).toContain('不影响你的身份、灵魂与语气设定');
  });

  it('未传 siliconstreamPersona 时身份锚定不缺身（回退为纯身份声明，不崩）', () => {
    const prompt = buildSystemPrompt({ ...baseArgs, agent: workstationRole, siliconstreamPersona: null });
    expect(prompt).toContain('你是 SiliconStream');
    expect(prompt).not.toContain('【既定人设');
  });

  it('未选角色时退回默认助手描述', () => {
    const prompt = buildSystemPrompt({ ...baseArgs, agent: null, siliconstreamPersona });
    expect(prompt).toContain('你是用户的个人情报分析助手');
    expect(prompt).toContain('我是 SiliconStream 的灵魂。');
  });

  it('工作空间关联文件：系统提示只列目录（v36.2 正文改为随消息携带）', () => {
    const longBody = 'X'.repeat(5000);
    const prompt = buildSystemPrompt({
      ...baseArgs,
      agent: null,
      siliconstreamPersona,
      workspaceFiles: [
        { name: 'app.jsx', path: 'src/app.jsx', content: longBody },
        { name: 'huge.md', path: 'docs/huge.md', content: '正文', truncated: true },
      ],
    });
    expect(prompt).toContain('【工作空间关联文件】');
    expect(prompt).toContain('src/app.jsx');
    expect(prompt).toContain('docs/huge.md');
    expect(prompt).toContain('随每条用户消息');
    expect(prompt).toContain('read_workspace_file');
    // 正文不再内嵌进系统提示（旧实现每文件仅保留 1200 字符的假上下文）
    expect(prompt).not.toContain(longBody.slice(0, 1200));
  });
});
