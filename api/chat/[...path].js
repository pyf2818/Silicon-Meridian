import { handleChatRequest } from '../../server/http/chatHandlers.js';
export default async function handler(req, res) { const value = req.query?.path; const path = Array.isArray(value) ? value : String(value || '').split('/'); return handleChatRequest(req, res, { path }); }
