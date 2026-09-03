import { getPool } from '../db/client.js';

const CONVERSATION_VIEW = `select c.id, c.kind, c.title, c.owner_id as "ownerId", c.invite_code as "inviteCode", c.created_at as "createdAt", c.updated_at as "updatedAt",
  (select count(*)::int from conversation_members cm2 where cm2.conversation_id = c.id) as "memberCount",
  (select json_build_object('id', m.id, 'body', m.body, 'kind', m.kind, 'sharePayload', m.share_payload, 'senderId', m.sender_id, 'createdAt', m.created_at)
   from messages m where m.conversation_id = c.id and m.deleted_at is null order by m.created_at desc limit 1) as "lastMessage"
  from conversations c join conversation_members cm on cm.conversation_id = c.id where cm.user_id = $1`;

export function createChatRepository(db = getPool()) {
  return {
    async listContacts(userId, search = '') {
      const pattern = `%${String(search || '').trim()}%`;
      const { rows } = await db.query(`select u.id, u.username, u.display_name as "displayName", u.avatar_url as avatar, uc.note, uc.created_at as "createdAt"
        from user_contacts uc join users u on u.id = uc.contact_id
        where uc.owner_id = $1 and u.status = 'active' and ($2 = '%%' or u.username ilike $2 or u.display_name ilike $2)
        order by u.display_name asc limit 50`, [userId, pattern]);
      return rows;
    },
    async addContact(userId, contactId, note = '') {
      const { rows } = await db.query(`insert into user_contacts(owner_id, contact_id, note) values ($1,$2,$3)
        on conflict (owner_id, contact_id) do update set note=excluded.note returning contact_id`, [userId, contactId, String(note).slice(0, 120)]);
      return rows[0];
    },
    async removeContact(userId, contactId) { await db.query('delete from user_contacts where owner_id=$1 and contact_id=$2', [userId, contactId]); },
    async findUser(userId) { const { rows } = await db.query(`select id, username, display_name as "displayName", avatar_url as avatar from users where id=$1 and status='active'`, [userId]); return rows[0] || null; },
    async listConversations(userId) { const { rows } = await db.query(`${CONVERSATION_VIEW} order by c.updated_at desc`, [userId]); return rows; },
    async getConversation(id, userId) { const { rows } = await db.query(`${CONVERSATION_VIEW} and c.id=$2 limit 1`, [userId, id]); return rows[0] || null; },
    async createConversation({ ownerId, kind, title, memberIds, inviteCode }) {
      const client = await db.connect();
      try { await client.query('begin'); const { rows } = await client.query(`insert into conversations(kind,title,owner_id,invite_code) values($1,$2,$3,$4) returning id`, [kind, title, ownerId, inviteCode]); const id = rows[0].id;
        const members = [...new Set([ownerId, ...(memberIds || [])])]; for (const memberId of members) await client.query(`insert into conversation_members(conversation_id,user_id,role) values($1,$2,$3) on conflict do nothing`, [id, memberId, memberId === ownerId ? 'owner' : 'member']); await client.query('commit'); return id;
      } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
    },
    async isMember(conversationId, userId) { const { rowCount } = await db.query('select 1 from conversation_members where conversation_id=$1 and user_id=$2', [conversationId, userId]); return rowCount > 0; },
    async joinConversation(conversationId, userId, inviteCode) { const { rows } = await db.query(`insert into conversation_members(conversation_id,user_id) select id,$1 from conversations where id=$2 and (invite_code=$3 or owner_id=$1) on conflict do nothing returning conversation_id`, [userId, conversationId, inviteCode || '']); return Boolean(rows[0]); },
    async joinByCode(userId, inviteCode) { const { rows } = await db.query(`insert into conversation_members(conversation_id,user_id) select id,$1 from conversations where invite_code=$2 and kind='group' on conflict do nothing returning conversation_id`, [userId, inviteCode]); return rows[0]?.conversation_id || null; },
    async listMessages(conversationId, { cursor = null, limit = 50 } = {}) { const { rows } = await db.query(`select m.id, m.body, m.kind, m.share_payload as "sharePayload", m.sender_id as "senderId", u.display_name as "senderName", u.avatar_url as avatar, m.created_at as "createdAt" from messages m join users u on u.id=m.sender_id where m.conversation_id=$1 and m.deleted_at is null and ($2::timestamptz is null or m.created_at < $2) order by m.created_at desc, m.id desc limit $3`, [conversationId, cursor, limit]); return rows.reverse(); },
    async createMessage({ conversationId, senderId, body, kind, sharePayload }) { const { rows } = await db.query(`insert into messages(conversation_id,sender_id,body,kind,share_payload) values($1,$2,$3,$4,$5) returning id, conversation_id as "conversationId", sender_id as "senderId", body, kind, share_payload as "sharePayload", created_at as "createdAt"`, [conversationId, senderId, body, kind, sharePayload ? JSON.stringify(sharePayload) : null]); await db.query('update conversations set updated_at=now() where id=$1', [conversationId]); return rows[0]; },
    async markRead(conversationId, userId) { await db.query('update conversation_members set last_read_at=now() where conversation_id=$1 and user_id=$2', [conversationId, userId]); },
  };
}
