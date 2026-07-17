import { describe, expect, it } from 'vitest';
import { parseAuthConfig } from '@/auth/config';

describe('authentication configuration', () => {
  it('accepts a matching WebAuthn origin and RP ID', () => {
    expect(
      parseAuthConfig({
        AUTH_SECRET: '0123456789abcdef0123456789abcdef',
        WEBAUTHN_ORIGIN: 'https://assets.example.com',
        WEBAUTHN_RP_ID: 'example.com',
      }),
    ).toEqual({
      origin: 'https://assets.example.com',
      rpID: 'example.com',
      rpName: '資産履歴管理',
      secret: '0123456789abcdef0123456789abcdef',
      secureCookies: true,
    });
  });

  it('rejects a short signing secret', () => {
    expect(() =>
      parseAuthConfig({
        AUTH_SECRET: 'too-short',
        WEBAUTHN_ORIGIN: 'http://localhost:3000',
        WEBAUTHN_RP_ID: 'localhost',
      }),
    ).toThrow('AUTH_SECRET');
  });

  it('rejects an origin outside the configured RP ID', () => {
    expect(() =>
      parseAuthConfig({
        AUTH_SECRET: '0123456789abcdef0123456789abcdef',
        WEBAUTHN_ORIGIN: 'https://evil.example.net',
        WEBAUTHN_RP_ID: 'example.com',
      }),
    ).toThrow('WEBAUTHN_ORIGIN');
  });

  it('rejects insecure HTTP outside localhost', () => {
    expect(() =>
      parseAuthConfig({
        AUTH_SECRET: '0123456789abcdef0123456789abcdef',
        WEBAUTHN_ORIGIN: 'http://example.com',
        WEBAUTHN_RP_ID: 'example.com',
      }),
    ).toThrow('HTTPS');
  });

  it('rejects a configured URL containing a path', () => {
    expect(() =>
      parseAuthConfig({
        AUTH_SECRET: '0123456789abcdef0123456789abcdef',
        WEBAUTHN_ORIGIN: 'https://example.com/login',
        WEBAUTHN_RP_ID: 'example.com',
      }),
    ).toThrow('origin without path');
  });
});
