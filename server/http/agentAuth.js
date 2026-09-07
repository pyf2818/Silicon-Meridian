// agentAuth.js - 共用的鉴权工具：从 cookie session 解析 userId
import { getAuthService } from '../auth/authService.js';
import { parseCookies } from './httpUtils.js';

// v22：改用 authService 的异步解析（含 dev 无 PG 时自动内存兜底），进程内记忆化
function getAuth() {
  return getAuthService();
}

/**
 * 从请求 cookie 中解析 userId
 * @param {Object} req - HTTP 请求
 * @returns {Promise<string|null>} userId 或 null（未登录）
 */
export async function getUserIdFromRequest(req) {
  const token = parseCookies(req.headers?.cookie || '').meridian_session || '';
  if (!token) return null;
  try {
    const auth = await getAuth();
    const user = await auth.authenticate(token);
    return user?.id || null;
  } catch {
    return null;
  }
}
