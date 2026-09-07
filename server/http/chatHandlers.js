import { getAuthService } from '../auth/authService.js';
import { getChatService } from '../chat/chatService.js';
import { parseCookies, readJsonBody, routeError, sendJsonResponse } from './httpUtils.js';

async function viewer(req, auth) {
  const user = await auth.authenticate(parseCookies(req).meridian_session || '');
  if (!user) throw Object.assign(new Error('????'), { code: 'UNAUTHORIZED', status: 401 });
  return user;
}
const json = (res, status, data) => sendJsonResponse(res, status, { ok: true, data });

export async function handleChatRequest(req, res, { path = [], service, authService } = {}) {
  try {
    const parts = (Array.isArray(path) ? path : String(path).split('/')).filter(Boolean);
    const method = String(req.method || 'GET').toUpperCase();
    const chat = service || await getChatService();
    const auth = authService || await getAuthService();
    const user = await viewer(req, auth);
    const body = ['POST', 'PATCH', 'PUT'].includes(method) ? await readJsonBody(req) : {};

    if (parts[0] === 'contacts' && parts.length === 1) {
      if (method === 'GET') {
        const url = new URL(req.url, 'http://localhost');
        return json(res, 200, { contacts: await chat.listContacts({ userId: user.id, search: url.searchParams.get('search') || '' }) });
      }
      if (method === 'POST') return json(res, 201, { contact: await chat.addContact({ userId: user.id, contactId: body.contactId, note: body.note }) });
    }
    if (parts[0] === 'contacts' && parts[1] && method === 'DELETE') {
      await chat.removeContact({ userId: user.id, contactId: parts[1] });
      return json(res, 200, {});
    }
    if (parts[0] === 'conversations' && parts.length === 1) {
      if (method === 'GET') return json(res, 200, { conversations: await chat.listConversations({ userId: user.id }) });
      if (method === 'POST') {
        if (body.inviteCode) return json(res, 201, { conversation: await chat.joinByCode({ userId: user.id, inviteCode: body.inviteCode }) });
        return json(res, 201, { conversation: await chat.createConversation({ userId: user.id, kind: body.kind, title: body.title, memberIds: Array.isArray(body.memberIds) ? body.memberIds : [] }) });
      }
    }
    if (parts[0] === 'conversations' && parts[1]) {
      const conversationId = parts[1];
      if (parts[2] === 'messages') {
        if (method === 'GET') {
          const url = new URL(req.url, 'http://localhost');
          return json(res, 200, await chat.listMessages({ userId: user.id, conversationId, cursor: url.searchParams.get('cursor'), limit: url.searchParams.get('limit') }));
        }
        if (method === 'POST') return json(res, 201, { message: await chat.sendMessage({ userId: user.id, conversationId, body: body.body, kind: body.kind, sharePayload: body.sharePayload }) });
      }
      if (parts[2] === 'join' && method === 'POST') return json(res, 200, { conversation: await chat.joinConversation({ userId: user.id, conversationId, inviteCode: body.inviteCode }) });
      if (parts[2] === 'read' && method === 'POST') {
        await chat.markRead({ userId: user.id, conversationId });
        return json(res, 200, {});
      }
    }
    throw Object.assign(new Error('???????'), { code: 'NOT_FOUND', status: 404 });
  } catch (error) {
    return routeError(res, error);
  }
}
