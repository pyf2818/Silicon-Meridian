import { createAuthService } from '../auth/authService.js';
import { createProfileService } from '../profile/profileService.js';
import * as snapshotRepository from '../profile/snapshotRepository.js';
import * as snapshotService from '../profile/snapshotService.js';
import { handleAiInsightsInternal } from './aiHandlers.js';
import { fetchRelevantMemoriesForItems, getPersonaSummary } from '../agent/agentMemoryService.js';
import { parseCookies, readJsonBody, routeError, sendJsonResponse } from './httpUtils.js';

export async function handleProfileRequest(req, res, { action = 'state', service, authService } = {}) {
  try {
    const auth = authService || createAuthService();
    const user = await auth.authenticate(parseCookies(req).meridian_session || '');
    if (!user) return sendJsonResponse(res, 401, { ok: false, error: { code: 'UNAUTHORIZED', message: '请先登录' } });
    const profile = service || createProfileService();
    if (action === 'state' && req.method === 'GET') return sendJsonResponse(res, 200, { ok: true, data: await profile.getState(user.id) });
    if (action === 'state' && req.method === 'PUT') return sendJsonResponse(res, 200, { ok: true, data: { version: await profile.saveState(user.id, await readJsonBody(req)) } });
    // Phase 3 Task A4: 跨设备 LLM 配置同步
    if (action === 'llm-config' && req.method === 'GET') return sendJsonResponse(res, 200, { ok: true, data: { config: await profile.getLlmConfig(user.id) } });
    if (action === 'llm-config' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const saved = await profile.setLlmConfig(user.id, body && body.config ? body.config : body);
      return sendJsonResponse(res, 200, { ok: true, data: { config: saved } });
    }

    // Phase 3 Task B4: 推荐快照路由
    // POST /api/profile/snapshots/preheat — 触发今日预热（缓存命中则直接返回）
    if (action === 'snapshots-preheat' && req.method === 'POST') {
      const today = new Date().toISOString().slice(0, 10);
      const existing = await snapshotRepository.getSnapshotByDate(user.id, today);
      if (existing) return sendJsonResponse(res, 200, { ok: true, snapshot: existing, cached: true });
      const result = await snapshotService.preheatForUser({ userId: user.id });
      return sendJsonResponse(res, 200, { ok: true, snapshot: result, cached: false });
    }

    // POST /api/profile/snapshots/analyze — 实时对传入 items 做 LLM 重新分析（不写三表）
    if (action === 'snapshots-analyze' && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!Array.isArray(body.items) || body.items.length === 0) {
        return sendJsonResponse(res, 400, { ok: false, error: { code: 'INVALID_ITEMS', message: 'items 不能为空' } });
      }
      const { personaSummary } = await getPersonaSummary(user.id);
      const llmConfig = await profile.getLlmConfig(user.id);
      if (!llmConfig?.baseUrl || !llmConfig?.selectedModel) {
        return sendJsonResponse(res, 400, { ok: false, error: { code: 'LLM_CONFIG_MISSING', message: '请先在设置中配置大模型' } });
      }
      const relevantMemories = await fetchRelevantMemoriesForItems(user.id, body.items).catch(() => []);
      const insights = await handleAiInsightsInternal({
        items: body.items.slice(0, 30),
        personaSummary,
        relevantMemories,
        llmConfig,
      });
      return sendJsonResponse(res, 200, { ok: true, insights });
    }

    // GET /api/profile/snapshots — 列表（?date= 指定则按日期查单条）
    if (action === 'snapshots' && req.method === 'GET') {
      const date = new URL(req.url, 'http://localhost').searchParams.get('date');
      if (date) {
        const snap = await snapshotRepository.getSnapshotByDate(user.id, date);
        return sendJsonResponse(res, 200, { ok: true, snapshot: snap });
      }
      const snaps = await snapshotRepository.getRecentSnapshots(user.id, 30);
      return sendJsonResponse(res, 200, { ok: true, snapshots: snaps });
    }

    return sendJsonResponse(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: '请求方法不支持' } });
  } catch (error) { return routeError(res, error); }
}
