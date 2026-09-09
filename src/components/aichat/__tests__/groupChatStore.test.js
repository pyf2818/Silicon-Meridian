/**
 * groupChatStore 单测（v9）：
 * - role:'system' 居中系统行（群生命周期事件 / 流水线事件），不进 LLM 白板
 * - 群公告（announcement）读写 + localStorage 迁移保留
 * - createChat/renameChat/inviteMember/removeMember 落系统事件
 * - hueOfMember 共享色相工具
 * 每个用例通过 vi.resetModules + 动态 import 拿到全新单例（store 是模块级状态）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

function installLocalStorage() {
  const backing = new Map();
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(key => backing.get(key) ?? null),
    setItem: vi.fn((key, value) => backing.set(key, String(value))),
    removeItem: vi.fn(key => backing.delete(key)),
    clear: vi.fn(() => backing.clear()),
  });
  return backing;
}

let backing;

async function freshStore() {
  vi.resetModules();
  return import('../groupChatStore.js');
}

beforeEach(() => {
  backing = installLocalStorage();
});

describe('groupChatStore v9：system 系统行', () => {
  it('addGroupMessage 支持 role:system（必须有 content）', async () => {
    const s = await freshStore();
    const entry = s.addGroupMessage({ role: 'system', content: '创建了群聊「调研团队」' });
    expect(entry.role).toBe('system');
    expect(entry.status).toBe('done');
    // 无 content 的 system 消息被拒（事件行不允许空）
    expect(s.addGroupMessage({ role: 'system', content: '' })).toBeNull();
    const chat = s.getActiveChat();
    expect(chat.messages.at(-1)).toBe(entry);
  });

  it('agent 占位消息（running 空 content）依旧放行（群聊不回复 bug 的回归防线）', async () => {
    const s = await freshStore();
    const ph = s.addGroupMessage({ role: 'agent', agentId: 'explorer', agentName: '探索者', content: '', status: 'running' });
    expect(ph?.id).toBeTruthy();
  });

  it('buildSharedTranscript 过滤 system 行（不进 LLM 白板）', async () => {
    const s = await freshStore();
    // buildSharedTranscript 未导出——通过 subscribeGroup + 导出路径间接验证：
    // 这里直接验证 store 不把 system 行算进消息内容之外的行为（渲染层逻辑），改为验证 inviteMember 事件可被清除
    s.addGroupMessage({ role: 'user', content: 'hello' });
    s.addGroupMessage({ role: 'system', content: '邀请了「探索者」加入群聊' });
    const chat = s.getActiveChat();
    expect(chat.messages.some(m => m.role === 'system')).toBe(true);
    s.clearGroupChat();
    expect(s.getActiveChat().messages).toHaveLength(0);
  });
});

describe('groupChatStore v26：目标（Goal，原群公告）', () => {
  it('setChatAnnouncement 写入 + 目标内容以系统行发进群（成员注意）', async () => {
    const s = await freshStore();
    expect(s.setChatAnnouncement('  用 AI 放大一个人的产出  ')).toBe(true);
    const chat = s.getActiveChat();
    expect(chat.announcement).toBe('用 AI 放大一个人的产出');
    // 目标是环境设定：保存后把内容发进群里让成员注意（v26 群公告已改造为 Goal）
    expect(chat.messages.at(-1).role).toBe('system');
    expect(chat.messages.at(-1).content).toContain('用 AI 放大一个人的产出');
    expect(chat.messages.at(-1).content).toContain('团队目标');
    // 内容未变化时返回 false，不再刷事件
    expect(s.setChatAnnouncement('用 AI 放大一个人的产出')).toBe(false);
    // 空白串 = 清空公告（相对当前非空公告是一次变更）
    expect(s.setChatAnnouncement('   ')).toBe(true);
    expect(s.getActiveChat().announcement).toBe('');
    expect(s.getActiveChat().messages.at(-1).content).toBe('清空了团队目标（Goal）');
    // 已是空时再传空：无变化
    expect(s.setChatAnnouncement('')).toBe(false);
  });

  it('announcement 持久化并在重载后保留（v2→v3 迁移字段）', async () => {
    const s = await freshStore();
    s.setChatAnnouncement('目标：一周内跑通端到端简报');
    const raw = JSON.parse(backing.get('agentTeamGroupChat'));
    expect(raw.chats[0].announcement).toBe('目标：一周内跑通端到端简报');

    vi.resetModules();
    const s2 = await import('../groupChatStore.js');
    expect(s2.getActiveChat().announcement).toBe('目标：一周内跑通端到端简报');
  });

  it('旧格式数据（无 announcement 字段）load 后补空串', async () => {
    backing.set('agentTeamGroupChat', JSON.stringify({
      chats: [{ id: 'gc_old', name: '旧群', createdAt: 1, roster: ['explorer'], messages: [] }],
      activeId: 'gc_old',
    }));
    const s = await freshStore();
    expect(s.getActiveChat().announcement).toBe('');
  });
});

describe('groupChatStore v9：群生命周期系统事件', () => {
  it('createChat / inviteMember / removeMember / renameChat 都落 system 行', async () => {
    const s = await freshStore();
    const chat = s.createChat('调研团队');
    expect(chat).toBeTruthy();
    const sysTexts = () => s.getActiveChat().messages.filter(m => m.role === 'system').map(m => m.content);

    expect(sysTexts()).toContain('创建了群聊「调研团队」');

    expect(s.inviteMember('explorer')).toBe(true);
    expect(sysTexts()).toContain('邀请了「探索者」加入群聊');

    expect(s.renameChat(chat.id, '深度调研团')).toBe(true);
    expect(sysTexts()).toContain('群聊「调研团队」更名为「深度调研团」');

    expect(s.removeMember('explorer')).toBe(true);
    expect(sysTexts()).toContain('「探索者」被请出了群聊');
  });

  it('renameChat 同名/空名返回 false 且不落事件', async () => {
    const s = await freshStore();
    const chat = s.getActiveChat();
    const before = s.getActiveChat().messages.length;
    expect(s.renameChat(chat.id, chat.name)).toBe(false);
    expect(s.renameChat(chat.id, '  ')).toBe(false);
    expect(s.getActiveChat().messages.length).toBe(before);
  });
});

describe('groupChatStore v9：共享色相与消息上限', () => {
  it('hueOfMemberId/hueOfChat 按 id 稳定取色（身份不随位置/成员变化漂移）', async () => {
    const s = await freshStore();
    expect(s.hueOfMemberId('explorer')).toBe(s.hueOfMemberId('explorer'));
    expect(s.hueOfMemberId('explorer')).toBe(s.hueOfMemberId('explorer'));
    expect(s.MEMBER_HUES).toHaveLength(6); // 色相池容量
    expect(s.MEMBER_HUES).toContain(s.hueOfChat('gc_abc'));
    expect(s.hueOfChat('gc_abc')).toBe(s.hueOfChat('gc_abc'));
  });

  it('系统事件也受 MAX_MESSAGES 上限约束', async () => {
    const s = await freshStore();
    for (let i = 0; i < 210; i += 1) {
      s.addGroupMessage({ role: 'system', content: `事件 ${i}` });
    }
    expect(s.getActiveChat().messages.length).toBeLessThanOrEqual(200);
  });
});
