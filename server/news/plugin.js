import { CATEGORIES, MODES, DEFAULT_SOURCES, SOURCE_GRADES, PAGE_SIZE } from './config/constants.js';
import { getSourceGrade, getSourceGradeInfo } from './config/sourceGrades.js';
import { sendJson, parseBody, isSafeUrl } from './utils/httpUtils.js';
import { handleAuthRequest } from '../http/authHandlers.js';
import { handleCommunityRequest } from '../http/communityHandlers.js';
import { handleCreativeRequest } from '../http/creativeHandlers.js';
import { handleProfileRequest } from '../http/profileHandlers.js';
import { handleAgentMemoryRequest } from '../http/agentMemoryHandlers.js';
import { handleAgentRunRequest } from '../http/agentRunHandlers.js';
import { handleAgentJobsRequest } from '../http/agentJobsHandlers.js';
import { startCronDaemon } from '../agent/agentJobsService.js';
import { handleAiGenerateRequest, handleAiInsightsRequest } from '../http/aiHandlers.js';
import { handleFetchPageRequest } from '../http/fetchPageHandler.js';
import { handleWebSearchRequest } from '../http/webSearchHandler.js';
import { handleIntelligenceRequest } from '../http/intelligenceHandlers.js';
import { getNews, warmNewsCache, startNewsWarming } from './services/newsService.js';
import { getTrending, getGithubTrending } from './services/trendingService.js';
import { discoverSourceCandidates, validateFeedUrl } from './services/sourceDiscovery.js';
import { getDashboard, getRealtime, getKline, getTimeline, getSectors, searchStock, resolveSecid } from './services/stockService.js';
import { createLastSeenHandler } from '../http/lastSeenMiddleware.js';

const E2E_INTELLIGENCE_ITEMS = [
  { id: 'openai-agent-1', canonicalId: 'event-openai-agent', title: 'OpenAI releases a new agent platform today', source: 'OpenAI Blog', category: 'ai', publishedAt: '2026-07-14T01:00:00Z', summary: 'Official agent platform release.', url: 'https://openai.com/index/agents' },
  { id: 'openai-agent-2', canonicalId: 'event-openai-agent', title: 'OpenAI releases new Agent platform', source: 'TechCrunch', category: 'ai', publishedAt: '2026-07-14T02:00:00Z', summary: 'Media coverage of the same agent platform.', url: 'https://techcrunch.com/openai-agent' },
  { id: 'nvidia-chip', canonicalId: 'event-nvidia-chip', title: 'NVIDIA expands AI accelerator supply', source: 'NVIDIA Blog', category: 'chips', publishedAt: '2026-07-14T04:00:00Z', summary: 'Accelerator supply update.', url: 'https://nvidia.com/blog/ai-chip' },
];

function sendE2eFixture(res, requestUrl) {
  if (process.env.SILICON_E2E !== '1') return false;
  if (requestUrl.pathname === '/api/intelligence/events') {
    sendJson(res, { ok: true, events: E2E_INTELLIGENCE_ITEMS, updatedAt: '2026-07-14T12:30:00Z' });
    return true;
  }
  if (requestUrl.pathname === '/api/intelligence/items') {
    sendJson(res, { ok: true, items: E2E_INTELLIGENCE_ITEMS, updatedAt: '2026-07-14T12:30:00Z' });
    return true;
  }
  if (requestUrl.pathname === '/api/intelligence/opportunities') {
    sendJson(res, { ok: true, opportunities: [] });
    return true;
  }
  if (requestUrl.pathname === '/api/intelligence/weekly-sectors') {
    sendJson(res, { ok: true, sectors: [] });
    return true;
  }
  if (requestUrl.pathname === '/api/intelligence/alerts') {
    sendJson(res, { ok: true, alerts: [] });
    return true;
  }
  if (requestUrl.pathname === '/api/news') {
    sendJson(res, { ok: true, items: E2E_INTELLIGENCE_ITEMS, total: E2E_INTELLIGENCE_ITEMS.length, hasMore: false });
    return true;
  }
  return false;
}

export function newsPlugin() {
  return {
    name: 'global-tech-news-api',
    configureServer(server) {
      // 启动资讯缓存定时预热：服务启动即预热一次，之后每 5 分钟自动刷新
      // 用户进入页面看到的总是新鲜或不超过 5 分钟的缓存数据
      const stopWarming = startNewsWarming(5 * 60 * 1000);
      // 启动 agent cron 守护：每 60 秒扫描到期任务，自动执行
      // 注意：cron 任务执行 LLM 需要 AGENT_LLM_CONFIG 环境变量
      const stopCron = startCronDaemon(60 * 1000);
      server.httpServer?.on?.('close', () => { stopWarming(); stopCron(); });

      const handleApiRequest = async (req, res, next) => {
        const requestUrl = new URL(req.url, 'http://localhost');
        if (sendE2eFixture(res, requestUrl)) return;

        if (requestUrl.pathname === '/api/meta') {
          return sendJson(res, {
            categories: CATEGORIES,
            modes: MODES,
            sources: DEFAULT_SOURCES.map(({ name, url, region, defaultCategory }) => {
              const gradeInfo = getSourceGradeInfo(name);
              return {
                name,
                url,
                region,
                defaultCategory,
                grade: getSourceGrade(name),
                gradeInfo: {
                  label: gradeInfo.label,
                  description: gradeInfo.description,
                  color: gradeInfo.color,
                  icon: gradeInfo.icon,
                  weight: gradeInfo.weight
                }
              };
            }),
            sourceGrades: SOURCE_GRADES
          });
        }

        // 认证、社区使用同一组 service/handler，避免开发环境和生产函数行为分叉。
        if (requestUrl.pathname.startsWith('/api/auth/')) {
          const action = requestUrl.pathname.slice('/api/auth/'.length);
          return handleAuthRequest(req, res, { action });
        }
        if (requestUrl.pathname === '/api/user/profile' || requestUrl.pathname === '/api/user/interests') {
          const action = requestUrl.pathname.endsWith('/interests') ? 'interests' : 'profile';
          return handleAuthRequest(req, res, { action });
        }
        if (requestUrl.pathname.startsWith('/api/community/')) {
          const path = requestUrl.pathname.slice('/api/community/'.length).split('/');
          return handleCommunityRequest(req, res, { path });
        }
        if (requestUrl.pathname.startsWith('/api/creative/')) {
          const path = requestUrl.pathname.slice('/api/creative/'.length).split('/');
          return handleCreativeRequest(req, res, { path });
        }
        if (requestUrl.pathname === '/api/profile/state') {
          return handleProfileRequest(req, res, { action: 'state' });
        }
        if (requestUrl.pathname === '/api/profile/llm-config') {
          return handleProfileRequest(req, res, { action: 'llm-config' });
        }
        // Phase 3 Task B4: 推荐快照路由（preheat / analyze / list）
        if (requestUrl.pathname === '/api/profile/snapshots/preheat') {
          return handleProfileRequest(req, res, { action: 'snapshots-preheat' });
        }
        if (requestUrl.pathname === '/api/profile/snapshots/analyze') {
          return handleProfileRequest(req, res, { action: 'snapshots-analyze' });
        }
        if (requestUrl.pathname === '/api/profile/snapshots') {
          return handleProfileRequest(req, res, { action: 'snapshots' });
        }
        if (requestUrl.pathname.startsWith('/api/agent-memory/')) {
          return handleAgentMemoryRequest(req, res, requestUrl.pathname, req.method);
        }
        if (requestUrl.pathname === '/api/agent/run' && req.method === 'POST') {
          return handleAgentRunRequest(req, res);
        }
        if (requestUrl.pathname.startsWith('/api/agent-jobs')) {
          return handleAgentJobsRequest(req, res, requestUrl.pathname, req.method);
        }
        if (requestUrl.pathname === '/api/ai-generate') {
          return handleAiGenerateRequest(req, res);
        }
        if (requestUrl.pathname === '/api/fetch-page') {
          return handleFetchPageRequest(req, res);
        }
        if (requestUrl.pathname === '/api/web-search') {
          return handleWebSearchRequest(req, res);
        }

        if (requestUrl.pathname === '/api/intelligence' || requestUrl.pathname.startsWith('/api/intelligence/')) {
          const path = requestUrl.pathname === '/api/intelligence'
            ? []
            : requestUrl.pathname.slice('/api/intelligence/'.length).split('/');
          return handleIntelligenceRequest(req, res, { path });
        }

        if (requestUrl.pathname === '/api/news') {
          const blocked = requestUrl.searchParams
            .get('blocked')
            ?.split(',')
            .map(word => word.trim().toLowerCase())
            .filter(Boolean) ?? [];

          const customParams = requestUrl.searchParams.getAll('custom');
          let customSources = [];
          try {
            customSources = customParams.map(p => JSON.parse(p)).filter(s => s.name && s.url);
          } catch {}

          const disabledSourcesParam = requestUrl.searchParams.get('disabledSources') || '';
          const disabledSources = disabledSourcesParam
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);

          const page = parseInt(requestUrl.searchParams.get('page') || '0', 10);
          const pageSize = parseInt(requestUrl.searchParams.get('pageSize') || String(PAGE_SIZE), 10);
          const search = requestUrl.searchParams.get('search') || '';
          const interestsParam = requestUrl.searchParams.get('interests') || '';
          const interests = interestsParam ? interestsParam.split(',').filter(Boolean) : [];
          const forceRefresh = requestUrl.searchParams.get('forceRefresh') === '1';
          const payload = await getNews(blocked, customSources, page, pageSize, search, disabledSources, interests, { forceRefresh });
          return sendJson(res, payload);
        }

        // 强制刷新资讯缓存：用户点"刷新"按钮或定时预热调用
        if (requestUrl.pathname === '/api/news/refresh') {
          const blocked = requestUrl.searchParams.get('blocked')?.split(',').map(w => w.trim().toLowerCase()).filter(Boolean) ?? [];
          const result = await warmNewsCache({ blocked });
          return sendJson(res, { ok: true, ...result });
        }

        if (requestUrl.pathname === '/api/trending') {
          const platform = requestUrl.searchParams.get('platform') || 'all';
          const page = parseInt(requestUrl.searchParams.get('page') || '0', 10);
          const pageSize = parseInt(requestUrl.searchParams.get('pageSize') || '60', 10);
          const payload = await getTrending(platform, page, pageSize);
          return sendJson(res, payload);
        }

        if (requestUrl.pathname === '/api/github-trending') {
          const lang = requestUrl.searchParams.get('lang') || '';
          const since = requestUrl.searchParams.get('since') || 'weekly';
          const payload = await getGithubTrending(lang, since);
          return sendJson(res, payload);
        }

        // ===== 股市动向 API =====
        if (requestUrl.pathname === '/api/stock/dashboard') {
          const payload = await getDashboard();
          return sendJson(res, payload);
        }

        if (requestUrl.pathname === '/api/stock/realtime') {
          const code = requestUrl.searchParams.get('code') || '';
          const secid = resolveSecid(code);
          if (!secid) return sendJson(res, { ok: false, message: '无效的股票代码' }, 400);
          const data = await getRealtime([secid]);
          return sendJson(res, data[0] || { ok: false, message: '未获取到数据' });
        }

        if (requestUrl.pathname === '/api/stock/kline') {
          const code = requestUrl.searchParams.get('code') || '';
          const period = requestUrl.searchParams.get('period') || '101';
          const adjust = requestUrl.searchParams.get('adjust') || '1';
          const count = parseInt(requestUrl.searchParams.get('count') || '60', 10);
          const secid = resolveSecid(code);
          if (!secid) return sendJson(res, { ok: false, message: '无效的股票代码' }, 400);
          if (!['0', '1', '2'].includes(adjust)) return sendJson(res, { ok: false, message: '无效的复权参数' }, 400);
          const data = await getKline(secid, { period, count, adjust });
          return sendJson(res, data || { ok: false, message: '未获取到K线数据' });
        }

        if (requestUrl.pathname === '/api/stock/search') {
          const keyword = requestUrl.searchParams.get('keyword') || '';
          if (!keyword) return sendJson(res, []);
          const data = await searchStock(keyword);
          return sendJson(res, data);
        }

        if (requestUrl.pathname === '/api/stock/timeline') {
          const code = requestUrl.searchParams.get('code') || '';
          const secid = resolveSecid(code);
          if (!secid) return sendJson(res, { ok: false, message: '无效的股票代码' }, 400);
          const data = await getTimeline(secid);
          return sendJson(res, data || { ok: false, message: '未获取到分时数据' });
        }

        if (requestUrl.pathname === '/api/stock/sectors') {
          const type = requestUrl.searchParams.get('type') === 'concept' ? 'concept' : 'industry';
          const data = await getSectors(type);
          return sendJson(res, data);
        }
        // ===== 股市动向 API END =====

        if (requestUrl.pathname === '/api/verify-source') {
          const url = requestUrl.searchParams.get('url') || '';
          if (!url) return sendJson(res, { ok: false, message: 'URL is required' }, 400);
          if (!isSafeUrl(url)) return sendJson(res, { ok: false, message: 'URL points to a blocked destination' }, 403);
          const result = await validateFeedUrl(url);
          return sendJson(res, result, result.ok ? 200 : 200);
        }

        if (requestUrl.pathname === '/api/discover-source') {
          const url = requestUrl.searchParams.get('url') || '';
          if (!url) return sendJson(res, { ok: false, message: 'URL is required', candidates: [] }, 400);
          const result = await discoverSourceCandidates(url);
          return sendJson(res, result, result.ok ? 200 : 200);
        }

        if (requestUrl.pathname === '/api/llm-models') {
          // 改用 POST 请求避免 API Key 暴露在 URL/日志中，同时兼容旧版 GET
          let baseUrl = '';
          let apiKey = '';
          if (req.method === 'POST') {
            const body = await parseBody(req);
            baseUrl = body.baseUrl || '';
            apiKey = body.apiKey || '';
          } else {
            baseUrl = requestUrl.searchParams.get('baseUrl') || '';
            apiKey = requestUrl.searchParams.get('apiKey') || '';
          }
          if (!baseUrl) return sendJson(res, { ok: false, message: 'baseUrl is required' }, 400);
          if (!isSafeUrl(baseUrl)) return sendJson(res, { ok: false, message: 'baseUrl points to a blocked destination' }, 403);
          try {
            // 兼容 baseUrl 已含 /v1 /v2 等版本路径的情况，与 /api/llm-test 处理一致
            const cleanBaseUrl = baseUrl.replace(/\/+$/, '');
            const apiUrl = cleanBaseUrl.endsWith('/v1') || cleanBaseUrl.endsWith('/v2') || cleanBaseUrl.endsWith('/v3') || cleanBaseUrl.endsWith('/v4')
              ? cleanBaseUrl + '/models'
              : cleanBaseUrl + '/v1/models';
            const headers = { 'Content-Type': 'application/json' };
            if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000);
            const response = await fetch(apiUrl, { headers, signal: controller.signal });
            clearTimeout(timeout);
            if (!response.ok) {
              const errText = await response.text().catch(() => '');
              return sendJson(res, { ok: false, message: `API responded ${response.status}: ${errText.slice(0, 200)}`, status: response.status });
            }
            const data = await response.json();
            // 兼容 OpenAI 风格 { data: [...] } 与简单数组 [...] 两种响应
            const list = Array.isArray(data) ? data : (data.data || data.models || []);
            const models = list.map(m => ({
              id: typeof m === 'string' ? m : (m.id || m.name),
              name: typeof m === 'string' ? m : (m.name || m.id),
              owned_by: typeof m === 'string' ? '' : (m.owned_by || m.owner || '')
            })).filter(m => m.id);
            return sendJson(res, { ok: true, models });
          } catch (e) {
            return sendJson(res, { ok: false, message: e.message });
          }
        }

        if (requestUrl.pathname === '/api/llm-test') {
          const body = await parseBody(req);
          const { baseUrl = '', apiKey = '', model = '', prompt = 'Hello' } = body;
          if (!baseUrl || !model) return sendJson(res, { ok: false, message: 'baseUrl and model are required' }, 400);
          try {
            const cleanBaseUrl = baseUrl.replace(/\/$/, '');
            const apiUrl = cleanBaseUrl.endsWith('/v1') || cleanBaseUrl.endsWith('/v2') || cleanBaseUrl.endsWith('/v3') || cleanBaseUrl.endsWith('/v4')
              ? cleanBaseUrl + '/chat/completions'
              : cleanBaseUrl + '/v1/chat/completions';
            const headers = { 'Content-Type': 'application/json' };
            if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000);
            const response = await fetch(apiUrl, {
              method: 'POST',
              headers,
              body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 50 }),
              signal: controller.signal
            });
            clearTimeout(timeout);
            if (!response.ok) {
              const errText = await response.text().catch(() => '');
              return sendJson(res, { ok: false, message: `API responded ${response.status}: ${errText.slice(0, 200)}` });
            }
            const data = await response.json();
            const reply = data.choices?.[0]?.message?.content || '';
            return sendJson(res, { ok: true, reply, model });
          } catch (e) {
            return sendJson(res, { ok: false, message: e.message });
          }
        }

        if (requestUrl.pathname === '/api/ai-insights') {
          return handleAiInsightsRequest(req, res);
        }

        if (requestUrl.pathname.startsWith('/api/ai/') || requestUrl.pathname.startsWith('/api/translate') || requestUrl.pathname.startsWith('/api/subscriptions') || requestUrl.pathname.startsWith('/api/bookmarks')) {
          return sendJson(res, { ok: false, message: 'Reserved extension endpoint.' }, 501);
        }

        return next();
      };

      server.middlewares.use(createLastSeenHandler());
      server.middlewares.use(async (req, res, next) => {
        try {
          return await handleApiRequest(req, res, next);
        } catch (error) {
          console.error('[newsPlugin] API middleware error:', error);
          if (!res.headersSent) {
            return sendJson(res, {
              ok: false,
              error: error?.message || 'Internal API error',
              path: req.url
            }, 500);
          }
          res.end();
        }
      });
    }
  };
}

export function createNewsApiMiddleware() {
  let middleware;
  newsPlugin().configureServer({
    middlewares: {
      use(handler) { middleware = handler; },
    },
  });
  if (!middleware) throw new Error('News API middleware was not initialized');
  return middleware;
}
