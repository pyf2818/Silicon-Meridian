import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getUserIdFromRequest } from '../agentAuth.js';
import { getAuthService } from '../../auth/authService.js';

vi.mock('../../auth/authService.js', () => ({ getAuthService: vi.fn() }));

describe('agent authentication', () => {
  const authenticate = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthService.mockResolvedValue({ authenticate });
  });

  it('authenticates the decoded session cookie', async () => {
    authenticate.mockResolvedValue({ id: 'user-1' });
    expect(await getUserIdFromRequest({ headers: { cookie: 'theme=dark; meridian_session=valid%2Btoken' } })).toBe('user-1');
    expect(authenticate).toHaveBeenCalledWith('valid+token');
  });

  it('rejects missing and malformed cookies without looking up a session', async () => {
    expect(await getUserIdFromRequest({ headers: {} })).toBeNull();
    expect(await getUserIdFromRequest({ headers: { cookie: 'meridian_session=%ZZ' } })).toBeNull();
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('rejects an expired session', async () => {
    authenticate.mockRejectedValue(new Error('Session expired'));
    expect(await getUserIdFromRequest({ headers: { cookie: 'meridian_session=expired' } })).toBeNull();
  });
});
