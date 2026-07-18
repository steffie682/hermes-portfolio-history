import { describe, expect, it, vi } from 'vitest';
import { authenticatedPrincipalId } from '@/auth/session';
import { resolvePageSessionPrincipal } from '@/auth/page-session';

describe('protected page session', () => {
  it('rejects a missing cookie without initializing the database runtime', async () => {
    const getRuntime = vi.fn();
    const principal = await resolvePageSessionPrincipal({
      readSessionToken: vi.fn().mockResolvedValue(undefined),
      getRuntime,
    });
    expect(principal).toBeNull();
    expect(getRuntime).not.toHaveBeenCalled();
  });

  it('accepts only a token resolved by the active session store', async () => {
    const findActiveUserByTokenHash = vi.fn().mockResolvedValue('user-a');
    const principal = await resolvePageSessionPrincipal({
      readSessionToken: vi.fn().mockResolvedValue('plain-cookie-token'),
      getRuntime: vi.fn().mockResolvedValue({ repository: { sessionStore: { findActiveUserByTokenHash } } }),
    });
    expect(principal && authenticatedPrincipalId(principal)).toBe('user-a');
    expect(findActiveUserByTokenHash).toHaveBeenCalledOnce();
  });
});
