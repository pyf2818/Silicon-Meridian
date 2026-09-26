import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cron from 'node-cron';
import { closePool } from './db/client.js';
import { createNewsApiMiddleware } from './newsPlugin.js';
import { updateLastSeen } from './http/lastSeenMiddleware.js';
import { runDailyPreheat } from './cron/dailyBriefingPreheatJob.js';

const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const DIST_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const MAX_PROXY_BODY = 2 * 1024 * 1024;
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// CSP report-only：只报告不阻断，先观察真实违规再逐步收紧为强制模式
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "media-src 'self' https:",
  "font-src 'self' data:",
  "connect-src 'self' https: http:"
].join('; ');

const apiMiddleware = createNewsApiMiddleware();

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_PROXY_BODY) throw Object.assign(new Error('Request body is too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function proxyScrapling(req, res, requestUrl) {
  const baseUrl = String(process.env.SCRAPLING_URL || '').replace(/\/+$/, '');
  if (!baseUrl) return sendJson(res, 503, { ok: false, error: 'Scrapling service is not configured' });
  const body = ['GET', 'HEAD'].includes(req.method || 'GET') ? undefined : await readBody(req);
  const response = await fetch(`${baseUrl}/api/scrape${requestUrl.search}`, {
    method: req.method,
    headers: {
      accept: req.headers.accept || 'application/json',
      'content-type': req.headers['content-type'] || 'application/json',
    },
    body,
    signal: AbortSignal.timeout(120_000),
    redirect: 'manual',
  });
  const payload = Buffer.from(await response.arrayBuffer());
  res.writeHead(response.status, {
    'Content-Type': response.headers.get('content-type') || 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

async function serveFile(req, res, filename) {
  const info = await stat(filename);
  if (!info.isFile()) throw Object.assign(new Error('Not found'), { code: 'ENOENT' });
  const extension = path.extname(filename).toLowerCase();
  const cspHeaders = extension === '.html' ? { 'Content-Security-Policy-Report-Only': CSP_REPORT_ONLY } : {};
  res.writeHead(200, {
    ...cspHeaders,
    'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': filename.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(filename).pipe(res);
}

async function serveFrontend(req, res, requestUrl) {
  if (!['GET', 'HEAD'].includes(req.method || 'GET')) return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
  let pathname;
  try { pathname = decodeURIComponent(requestUrl.pathname); } catch { return sendJson(res, 400, { ok: false, error: 'Invalid path' }); }
  const candidate = path.resolve(DIST_DIR, `.${pathname}`);
  if (candidate !== DIST_DIR && !candidate.startsWith(`${DIST_DIR}${path.sep}`)) return sendJson(res, 403, { ok: false, error: 'Forbidden path' });
  try {
    return await serveFile(req, res, pathname === '/' ? path.join(DIST_DIR, 'index.html') : candidate);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return serveFile(req, res, path.join(DIST_DIR, 'index.html'));
  }
}

const server = http.createServer(async (req, res) => {
  // last_seen_at 节流更新：res.on('finish') 在响应结束后异步触发，不阻塞响应
  if (res.on) {
    res.on('finish', () => {
      if (req.userId) updateLastSeen(req.userId);
    });
  }
  try {
    const requestUrl = new URL(req.url || '/', 'http://localhost');
    if (requestUrl.pathname === '/health') {
      // 进程健康快照（rss/heap/audit 失败计数/DB 探测），对齐 supervisor 可观测语义
      const { handleHealthRequest } = await import('./http/healthHandler.js');
      return handleHealthRequest(req, res);
    }
    if (requestUrl.pathname === '/api/scrape') return await proxyScrapling(req, res, requestUrl);
    if (requestUrl.pathname.startsWith('/api/')) {
      return await apiMiddleware(req, res, () => sendJson(res, 404, { ok: false, error: 'API route not found' }));
    }
    return await serveFrontend(req, res, requestUrl);
  } catch (error) {
    console.error('[productionServer]', error);
    if (!res.headersSent) sendJson(res, error?.status || 500, { ok: false, error: error?.message || 'Internal server error' });
    else res.end();
  }
});

server.listen(PORT, process.env.SERVER_HOST || '0.0.0.0', () => {
  console.log(`SiliconStream listening on http://0.0.0.0:${PORT}`);
  // Phase 3 Task B5: 注册每日简报预热 cron — 06:00 Asia/Shanghai
  // 仅在生产环境注册，避免 dev 环境意外触发上游 LLM 调用
  if (process.env.NODE_ENV === 'production') {
    cron.schedule('0 6 * * *', () => {
      runDailyPreheat().catch(err => console.error('[preheat] cron error:', err));
    }, { timezone: 'Asia/Shanghai' });
    console.log('[cron] daily preheat registered for 06:00 Asia/Shanghai');
    // 批 8：记忆蒸馏 cron —— 每天 04:00 跑一轮（repository 未接线时 runMemoryDistill 自动跳过）
    cron.schedule('0 4 * * *', async () => {
      try {
        const { runMemoryDistill } = await import('./agent/memoryDistillService.js');
        const result = await runMemoryDistill({ options: { staleDays: 30 } });
        console.log('[cron] memory distill:', JSON.stringify(result));
      } catch (err) {
        console.error('[cron] memory distill error:', err);
      }
    }, { timezone: 'Asia/Shanghai' });
    console.log('[cron] memory distill registered for 04:00 Asia/Shanghai');
  }
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return; // 防重入：SIGINT 连按/信号风暴只走一次
  shuttingDown = true;
  console.log(`[productionServer] ${signal} received, shutting down...`);
  try { server.closeIdleConnections?.(); } catch {} // keep-alive 空闲连接立即断开，加速 close 收敛
  server.close(async () => {
    try { await closePool(); } catch (err) { console.error('[productionServer] closePool error:', err); }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref(); // 兜底强退：有连接挂死也不超过 10s
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// 进程级兜底（对齐 supervisor 可观测语义）：
// unhandledRejection 记录不退出 —— 后台 fire-and-forget 路径的单点失败不杀全体在线用户
process.on('unhandledRejection', (reason) => {
  console.error('[productionServer] unhandledRejection:', reason);
});
// uncaughtException 同步异常栈可能已损坏 —— 记录后走优雅退出，交给容器编排重启
process.on('uncaughtException', (err) => {
  console.error('[productionServer] uncaughtException:', err);
  shutdown('uncaughtException');
});
