import { describe, expect, it, vi } from 'vitest';
import { beginPasskeyAuthentication } from '@/auth/passkey-authentication';
import { hashSessionToken } from '@/auth/session-token';

const config = {
  origin: 'http://localhost:3000',
  rpID: 'localhost',
  rpName: '資産履歴管理',
  secret: '0123456789abcdef0123456789abcdef',
  secureCookies: false,
};

describe('passkey authentication', () => {
  it('stores a challenge bound to an opaque cookie token', async () => {
    const saveChallenge = vi.fn().mockResolvedValue(undefined);
    const result = await beginPasskeyAuthentication({
      config,
      saveChallenge,
      createChallengeToken: () => 'challenge-cookie-token',
      now: new Date('2026-07-17T12:00:00Z'),
    });

    expect(result.options.userVerification).toBe('required');
    expect(saveChallenge).toHaveBeenCalledWith({
      challenge: result.options.challenge,
      ceremony: 'authentication',
      contextHash: hashSessionToken('challenge-cookie-token'),
      expiresAt: new Date('2026-07-17T12:05:00Z'),
    });
    expect(result.challengeToken).toBe('challenge-cookie-token');
  });
});
