import { describe, expect, it, vi } from 'vitest';
import {
  authenticatedPrincipalId,
  resolveSessionPrincipal,
} from '@/auth/session';
import { hashSessionToken } from '@/auth/session-token';

describe('session resolution', () => {
  it('looks up an active session by token hash and returns its user', async () => {
    const findActiveUserByTokenHash = vi.fn().mockResolvedValue('user-a');

    const principal = await resolveSessionPrincipal(
        'plain-cookie-token',
        { findActiveUserByTokenHash },
        new Date('2026-07-17T12:00:00Z'),
      );
    expect(principal && authenticatedPrincipalId(principal)).toBe('user-a');
    expect(findActiveUserByTokenHash).toHaveBeenCalledWith(
      hashSessionToken('plain-cookie-token'),
      new Date('2026-07-17T12:00:00Z'),
    );
  });
});
