import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { describe, expect, it, vi } from 'vitest';
import { finishPasskeyRegistration } from '@/auth/passkey-registration';
import { createRegistrationContext } from '@/auth/registration-context';
import { hashSessionToken } from '@/auth/session-token';

const config = {
  origin: 'http://localhost:3000',
  rpID: 'localhost',
  rpName: '資産履歴管理',
  secret: '0123456789abcdef0123456789abcdef',
  secureCookies: false,
};

describe('passkey registration completion', () => {
  it('verifies the challenge and atomically persists user, credential, and session', async () => {
    const now = new Date('2026-07-17T12:00:00Z');
    const context = createRegistrationContext(
      { userId: 'user-1', name: 'Steffie', expiresAt: now.getTime() + 60_000 },
      config.secret,
    );
    const verifyRegistration = vi.fn().mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: 'credential-1',
          publicKey: new Uint8Array([1, 2, 3]),
          counter: 7,
          transports: ['internal'],
        },
        credentialDeviceType: 'multiDevice',
        credentialBackedUp: true,
      },
    });
    const persistRegistration = vi.fn().mockResolvedValue(undefined);

    const result = await finishPasskeyRegistration(
      { context, response: {} as RegistrationResponseJSON },
      {
        config,
        now,
        loadChallenge: vi.fn().mockResolvedValue({ challenge: 'challenge-1' }),
        verifyRegistration,
        persistRegistration,
        createSessionToken: () => 'session-token',
      },
    );

    expect(verifyRegistration).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedChallenge: 'challenge-1',
        expectedOrigin: config.origin,
        expectedRPID: config.rpID,
        requireUserVerification: true,
      }),
    );
    expect(persistRegistration).toHaveBeenCalledWith(
      expect.objectContaining({
        user: { id: 'user-1', name: 'Steffie' },
        credential: expect.objectContaining({ id: 'credential-1', counter: 7 }),
        session: expect.objectContaining({
          tokenHash: hashSessionToken('session-token'),
        }),
        contextHash: hashSessionToken(context),
      }),
    );
    expect(result.sessionToken).toBe('session-token');
  });
});
