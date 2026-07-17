import { describe, expect, it } from 'vitest';
import { challengeCookieOptions, sessionCookieOptions } from '@/auth/cookies';

const config = {
  origin: 'https://assets.example.com',
  rpID: 'example.com',
  rpName: '資産履歴管理',
  secret: '0123456789abcdef0123456789abcdef',
  secureCookies: true,
};

describe('authentication cookies', () => {
  it('uses HttpOnly, Secure, and strict same-site cookies', () => {
    expect(sessionCookieOptions(config)).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
    });
    expect(challengeCookieOptions(config)).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
    });
  });
});
