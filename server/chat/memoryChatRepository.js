import { randomUUID } from 'node:crypto';
import { __memoryStore } from '../auth/memoryAuthRepository.js';

/**
 * 开发态内存版群聊仓储（v22 简化登录配套）。
 *
 * 仅在 isDevMemoryMode()（非 production 且未配置 DATABASE_URL）时由 chatService 启用，
 * 与 memoryAuthRepository 共享同一份用户内存数据（昵称/头像直接读用户行）。
 * 数据存进程内存：dev server 重启即清空——这是「临时简化方案」的预期行为，
 * 商业化阶段由真实 PostgreSQL（chatRepository.js）接管。
 *
 * 返回行形状与 chatRepository.js 的 SQL 视图对齐：
 *   conversation: { id, kind, title, ownerId, inviteCode, createdAt, updatedAt, memberCount, lastMessage }
 *   message:      { id, conversationId, senderId, senderName, avatar, body, kind, sharePayload, createdAt }
 */
const contacts = new Map();       // ownerId -> Map(contactId -> { note, createdAt })
const conversations = new Map();  // id -> { id, kind, title, ownerId, inviteCode, createdAt, updatedAt, members: Map<userId, { role, lastReadAt }> }
const messages = new Map();       // conversationId -> [message 行]（created_at 升序）

function getUser(userId) {
  return __memoryStore.users.get(userId) || null;
}

function publicUserBrief(row) {
  if (!row) return null;
  return { id: row.id, username: row.username, displayName: row.display_name || row.username, avatar: row.avatar_url || '' };
}

function lastMessageOf(conversationId) {
  const list = messages.get(conversationId) || [];
  const last = list[list.length - 1];
  if (!last) return null;
  return { id: last.id, body: last.body, kind: last.kind, sharePayload: last.share_payload, senderId: last.sender_id, createdAt: last.created_at };
}

function conversationView(conv) {
  return {
    id: conv.id,
    kind: conv.kind,
    title: conv.title,
    ownerId: conv.ownerId,
    inviteCode: conv.inviteCode,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    memberCount: conv.members.size,
    lastMessage: lastMessageOf(conv.id),
  };
}

export function createMemoryChatRepository() {
  return {
    async listContacts(userId, search = '') {
      const q = String(search || '').trim().toLowerCase();
      const out = [];
      for (const [contactId, meta] of (contacts.get(userId) || new Map())) {
        const u = getUser(contactId);
        if (!u || u.status !== 'active') continue;
        const displayName = u.display_name || u.username;
        if (q && !String(u.username).toLowerCase().includes(q) && !String(displayName).toLowerCase().includes(q)) continue;
        out.push({ id: u.id, username: u.username, displayName, avatar: u.avatar_url || '', note: meta.note, createdAt: meta.createdAt });
      }
      return out.sort((a, b) => String(a.displayName).localeCompare(String(b.displayName))).slice(0, 50);
    },

    async addContact(userId, contactId, note = '') {
      const map = contacts.get(userId) || new Map();
      map.set(contactId, { note: String(note).slice(0, 120), createdAt: (map.get(contactId) || {}).createdAt || new Date().toISOString() });
      contacts.set(userId, map);
      return { contactId };
    },

    async removeContact(userId, contactId) {
      contacts.get(userId)?.delete(contactId);
    },

    async findUser(userId) {
      const u = getUser(userId);
      return u && u.status === 'active' ? publicUserBrief(u) : null;
    },

    async listConversations(userId) {
      const out = [];
      for (const conv of conversations.values()) {
        if (conv.members.has(userId)) out.push(conversationView(conv));
      }
      return out.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    },

    async getConversation(id, userId) {
      const conv = conversations.get(id);
      return conv && conv.members.has(userId) ? conversationView(conv) : null;
    },

    async createConversation({ ownerId, kind, title, memberIds, inviteCode }) {
      const id = randomUUID();
      const now = new Date().toISOString();
      const conv = {
        id, kind, title, ownerId, inviteCode: inviteCode || null,
        createdAt: now, updatedAt: now,
        members: new Map(),
      };
      for (const memberId of [...new Set([ownerId, ...(memberIds || [])])]) {
        conv.members.set(memberId, { role: memberId === ownerId ? 'owner' : 'member', lastReadAt: null });
      }
      conversations.set(id, conv);
      messages.set(id, []);
      return id;
    },

    async isMember(conversationId, userId) {
      return conversations.get(conversationId)?.members.has(userId) || false;
    },

    async joinConversation(conversationId, userId, inviteCode) {
      const conv = conversations.get(conversationId);
      if (!conv) return false;
      if (conv.members.has(userId)) return false;
      if (conv.inviteCode && conv.inviteCode !== (inviteCode || '') && conv.ownerId !== userId) return false;
      conv.members.set(userId, { role: 'member', lastReadAt: null });
      return true;
    },

    async joinByCode(userId, inviteCode) {
      for (const conv of conversations.values()) {
        if (conv.kind === 'group' && conv.inviteCode && conv.inviteCode === inviteCode) {
          if (!conv.members.has(userId)) conv.members.set(userId, { role: 'member', lastReadAt: null });
          return conv.id;
        }
      }
      return null;
    },

    async listMessages(conversationId, { cursor = null, limit = 50 } = {}) {
      const all = messages.get(conversationId) || [];
      let rows = all.filter(m => !m.deleted_at); // 已按 createdAt 升序
      if (cursor) rows = rows.filter(m => new Date(m.created_at) < new Date(cursor));
      rows = rows.slice(-limit); // 取最近的 limit 条，仍升序（与 PG 版语义一致）
      return rows.map(m => {
        const u = getUser(m.sender_id);
        return {
          id: m.id,
          body: m.body,
          kind: m.kind,
          sharePayload: m.share_payload,
          senderId: m.sender_id,
          senderName: u?.display_name || u?.username || '未知用户',
          avatar: u?.avatar_url || '',
          createdAt: m.created_at,
        };
      });
    },

    async createMessage({ conversationId, senderId, body, kind, sharePayload }) {
      const now = new Date().toISOString();
      const row = {
        id: randomUUID(),
        conversation_id: conversationId,
        sender_id: senderId,
        body,
        kind,
        share_payload: sharePayload || null,
        created_at: now,
        deleted_at: null,
      };
      const list = messages.get(conversationId) || [];
      list.push(row);
      messages.set(conversationId, list);
      const conv = conversations.get(conversationId);
      if (conv) conv.updatedAt = now;
      const u = getUser(senderId);
      return {
        id: row.id, conversationId, senderId, body, kind,
        sharePayload: row.share_payload, createdAt: row.created_at,
        senderName: u?.display_name || u?.username || '未知用户',
        avatar: u?.avatar_url || '',
      };
    },

    async markRead(conversationId, userId) {
      const member = conversations.get(conversationId)?.members.get(userId);
      if (member) member.lastReadAt = new Date().toISOString();
    },
  };
}

export const __memoryChatStore = { contacts, conversations, messages };
