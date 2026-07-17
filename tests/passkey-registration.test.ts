import { describe, expect, it, vi } from 'vitest';
import { beginPasskeyRegistration } from '@/auth/passkey-registration';
import { verifyRegistrationContext } from '@/auth/registration-context';
import { hashSessionToken } from '@/auth/session-token';

const config = {
  origin: 'http://localhost:3000',
  rpID: 'localhost',
  rpName: '資産履歴管理',
  secret: '0123456789abcdef0123456789abcdef',
  secureCookies: false,
};

describe('passkey registration', () => {
  it('stores an expiring challenge bound to a signed identity context', async () => {
    const saveChallenge = vi.fn().mockResolvedValue(undefined);
    const now = new Date('2026-07-17T12:00:00Z');

    const result = await beginPasskeyRegistration(
      { name: '  Steffie  ' },
      { config, saveChallenge, createUserId: () => 'user-1', now },
    );

    expect(result.options.challenge).toBeTruthy();
    expect(
      verifyRegistrationContext(result.context, config.secret, now.getTime()),
    ).toMatchObject({ userId: 'user-1', name: 'Steffie' });
    expect(saveChallenge).toHaveBeenCalledWith({
      challenge: result.options.challenge,
      ceremony: 'registration',
      contextHash: hashSessionToken(result.context),
      expiresAt: new Date('2026-07-17T12:05:00Z'),
    });
  });
});
