import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { describe, expect, it, vi } from 'vitest';
import { finishPasskeyAuthentication } from '@/auth/passkey-authentication';
import { hashSessionToken } from '@/auth/session-token';

const config = {
  origin: 'http://localhost:3000',
  rpID: 'localhost',
  rpName: '資産履歴管理',
  secret: '0123456789abcdef0123456789abcdef',
  secureCookies: false,
};

describe('passkey authentication completion', () => {
  it('verifies the assertion, advances the counter, and creates a session', async () => {
    const verifyAuthentication = vi.fn().mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 9 },
    });
    const persistAuthentication = vi.fn().mockResolvedValue(undefined);
    const response = { id: 'credential-1' } as AuthenticationResponseJSON;

    const result = await finishPasskeyAuthentication(
      { challengeToken: 'challenge-token', response },
      {
        config,
        now: new Date('2026-07-17T12:00:00Z'),
        loadChallenge: vi.fn().mockResolvedValue({ challenge: 'challenge-1' }),
        loadCredential: vi.fn().mockResolvedValue({
          id: 'credential-1',
          userId: 'user-1',
          publicKey: Buffer.from([1, 2, 3]),
          counter: 7,
          transports: ['internal'],
        }),
        verifyAuthentication,
        persistAuthentication,
        createSessionToken: () => 'session-token',
      },
    );

    expect(verifyAuthentication).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedChallenge: 'challenge-1',
        expectedOrigin: config.origin,
        expectedRPID: config.rpID,
        requireUserVerification: true,
        credential: expect.objectContaining({ id: 'credential-1', counter: 7 }),
      }),
    );
    expect(persistAuthentication).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialId: 'credential-1',
        previousCounter: 7,
        newCounter: 9,
        userId: 'user-1',
        tokenHash: hashSessionToken('session-token'),
        contextHash: hashSessionToken('challenge-token'),
      }),
    );
    expect(result.sessionToken).toBe('session-token');
  });
});
