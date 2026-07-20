import { describe, expect, it, vi } from 'vitest';
import { beginDeviceEnrollment } from '@/auth/device-enrollment';
import { resolveSessionPrincipal } from '@/auth/session';
import { hashSessionToken } from '@/auth/session-token';

async function principal() {
  const value = await resolveSessionPrincipal('source-session', {
    findActiveUserByTokenHash: vi.fn().mockResolvedValue('existing-user'),
  });
  if (!value) throw new Error('test principal missing');
  return value;
}

describe('device enrollment grant', () => {
  it('binds a five-minute single-use grant to a recently verified existing session', async () => {
    const databaseExpiresAt = new Date('2026-07-20T00:04:59.900Z');
    const saveGrant = vi.fn().mockResolvedValue(databaseExpiresAt);
    const now = new Date('2026-07-20T00:00:00Z');
    const result = await beginDeviceEnrollment(
      { principal: await principal(), sessionToken: 'source-session' },
      {
        now,
        createToken: () => 'raw-enrollment-token',
        createChallenge: () => 'registration-challenge',
        saveGrant,
      },
    );

    expect(result).toEqual({
      grantToken: 'raw-enrollment-token',
      expiresAt: databaseExpiresAt,
    });
    expect(saveGrant).toHaveBeenCalledWith(
      await principal(),
      hashSessionToken('source-session'),
      {
        tokenHash: hashSessionToken('raw-enrollment-token'),
        challenge: 'registration-challenge',
      },
      now,
    );
  });
});
