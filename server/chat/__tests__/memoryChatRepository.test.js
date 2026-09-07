import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryChatRepository, __memoryChatStore } from '../memoryChatRepository.js';
import { createMemoryAuthRepository, __memoryStore } from '../../auth/memoryAuthRepository.js';

/** 直接种两个用户进认证内存库，供会话/联系人关联 */
async function seedUsers() {
  const auth = createMemoryAuthRepository();
  const pwd = { hash: 'h', salt: 's', params: {} };
  const alice = await auth.createUser({ username: 'alice', email: '', password: pwd, displayName: '爱丽丝' });
  const bob = await auth.createUser({ username: 'bob', email: '', password: pwd, displayName: '鲍勃' });
  return { alice, bob };
}

describe('memoryChatRepository（v22 无 DB 兜底）', () => {
  beforeEach(() => {
    __memoryStore.users.clear();
    __memoryStore.identityIndex.clear();
    __memoryChatStore.contacts.clear();
    __memoryChatStore.conversations.clear();
    __memoryChatStore.messages.clear();
  });

  it('建群 → 成员互见 → 发消息 → 消息含发送者昵称', async () => {
    const repo = createMemoryChatRepository();
    const { alice, bob } = await seedUsers();
    const convId = await repo.createConversation({
      ownerId: alice.id, kind: 'group', title: '测试群', memberIds: [bob.id], inviteCode: 'INVITE1',
    });
    expect(await repo.isMember(convId, alice.id)).toBe(true);
    expect(await repo.isMember(convId, bob.id)).toBe(true);

    const convAlice = await repo.getConversation(convId, alice.id);
    expect(convAlice.memberCount).toBe(2);
    expect(convAlice.title).toBe('测试群');

    await repo.createMessage({ conversationId: convId, senderId: bob.id, body: '大家好', kind: 'text' });
    const msgs = await repo.listMessages(convId, { limit: 10 });
    expect(msgs.length).toBe(1);
    expect(msgs[0].senderName).toBe('鲍勃');
    expect(msgs[0].body).toBe('大家好');
    // 群列表里能看到 lastMessage
    const list = await repo.listConversations(alice.id);
    expect(list[0].lastMessage.body).toBe('大家好');
  });

  it('邀请码入群与无效邀请码拒绝', async () => {
    const repo = createMemoryChatRepository();
    const { alice, bob } = await seedUsers();
    const convId = await repo.createConversation({ ownerId: alice.id, kind: 'group', title: 'g', memberIds: [], inviteCode: 'CODE9' });
    expect(await repo.joinByCode(bob.id, 'CODE9')).toBe(convId);
    const outsider = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    expect(await repo.joinByCode(outsider, 'WRONG')).toBeNull();
  });

  it('联系人增删与搜索', async () => {
    const repo = createMemoryChatRepository();
    const { alice, bob } = await seedUsers();
    await repo.addContact(alice.id, bob.id, '同事');
    let list = await repo.listContacts(alice.id);
    expect(list.length).toBe(1);
    expect(list[0].displayName).toBe('鲍勃');
    list = await repo.listContacts(alice.id, '鲍勃');
    expect(list.length).toBe(1);
    list = await repo.listContacts(alice.id, '不匹配');
    expect(list.length).toBe(0);
    await repo.removeContact(alice.id, bob.id);
    expect((await repo.listContacts(alice.id)).length).toBe(0);
  });
});
