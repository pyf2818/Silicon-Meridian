import { createChatRepository } from './chatRepository.js';
import { randomBytes } from 'node:crypto';
function fail(code, message, status = 400) { throw Object.assign(new Error(message), { code, status }); }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id = value => { if (!UUID_RE.test(String(value || ''))) fail('INVALID_ID', 'ID 无效'); return value; };
export function createChatService(repository = createChatRepository()) {
  return {
    async listContacts({ userId, search }) { return repository.listContacts(userId, search); },
    async addContact({ userId, contactId, note }) { id(contactId); if (userId === contactId) fail('INVALID_CONTACT', '不能添加自己'); if (!await repository.findUser(contactId)) fail('USER_NOT_FOUND', '用户不存在', 404); return repository.addContact(userId, contactId, note); },
    async removeContact({ userId, contactId }) { return repository.removeContact(userId, id(contactId)); },
    async listConversations({ userId }) { return repository.listConversations(userId); },
    async createConversation({ userId, kind = 'direct', title = '', memberIds = [] }) { if (!['direct','group'].includes(kind)) fail('INVALID_KIND', '会话类型无效'); const members = [...new Set(memberIds.map(id))]; if (kind === 'direct' && members.length !== 1) fail('DIRECT_MEMBER_REQUIRED', '私聊需要一个联系人'); if (kind === 'group' && members.length < 1) fail('GROUP_MEMBER_REQUIRED', '群聊至少需要一位成员'); const inviteCode = kind === 'group' ? randomBytes(5).toString('hex') : null; const conversationId = await repository.createConversation({ ownerId: userId, kind, title: String(title).trim().slice(0,120) || (kind === 'group' ? '新群聊' : ''), memberIds: members, inviteCode }); return repository.getConversation(conversationId, userId); },
    async joinConversation({ userId, conversationId, inviteCode }) { id(conversationId); if (!await repository.joinConversation(conversationId, userId, inviteCode)) fail('JOIN_FAILED', '邀请码无效或你已在群聊中', 400); return repository.getConversation(conversationId, userId); },
    async joinByCode({ userId, inviteCode }) { const conversationId = await repository.joinByCode(userId, String(inviteCode || '').trim()); if (!conversationId) fail('INVITE_INVALID', '邀请码无效', 400); return repository.getConversation(conversationId, userId); },
    async listMessages({ userId, conversationId, cursor, limit }) { id(conversationId); if (!await repository.isMember(conversationId, userId)) fail('FORBIDDEN', '你不是会话成员', 403); const items = await repository.listMessages(conversationId, { cursor, limit: Math.min(100, Math.max(1, Number(limit) || 50)) }); return { items, nextCursor: items.length ? items[0].createdAt : null }; },
    async sendMessage({ userId, conversationId, body, kind = 'text', sharePayload = null }) { id(conversationId); if (!await repository.isMember(conversationId, userId)) fail('FORBIDDEN', '你不是会话成员', 403); const text = String(body || '').trim(); if (kind === 'text' && !text) fail('EMPTY_MESSAGE', '消息不能为空'); if (text.length > 4000) fail('MESSAGE_TOO_LONG', '消息过长'); if (!['text','share'].includes(kind)) fail('INVALID_KIND', '消息类型无效'); return repository.createMessage({ conversationId, senderId: userId, body: text, kind, sharePayload }); },
    async markRead({ userId, conversationId }) { id(conversationId); if (!await repository.isMember(conversationId, userId)) fail('FORBIDDEN', '你不是会话成员', 403); await repository.markRead(conversationId, userId); },
  };
}
