import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { createDeviceEnrollmentHandlers } from '@/auth/device-enrollment-http';
import type { AuthConfig } from '@/auth/types';

const grantToken = 'g'.repeat(43);

const config: AuthConfig = {
  secret: 'a'.repeat(32),
  origin: 'https://portfolio.example',
  rpID: 'portfolio.example',
  rpName: '資産履歴管理',
  secureCookies: true,
};

function request(
  path: string,
  init: { body?: BodyInit | null; headers?: HeadersInit } = {},
) {
  const headers = new Headers(init.headers);
  if (!headers.has('origin')) headers.set('origin', config.origin);
  if (!headers.has('cookie')) headers.set('cookie', 'portfolio_session=source-session');
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return new NextRequest(`https://portfolio.example${path}`, {
    ...init,
    method: 'POST',
    headers,
  });
}

function handlers() {
  const sessionStore = {
    findActiveUserByTokenHash: vi.fn().mockResolvedValue('existing-user'),
  };
  const services = {
    beginEnrollment: vi.fn().mockResolvedValue({
      grantToken,
      expiresAt: new Date('2026-07-20T00:05:00Z'),
    }),
    getOptions: vi.fn().mockResolvedValue({ challenge: 'challenge' }),
    finishEnrollment: vi.fn().mockResolvedValue({ sessionToken: 'target-session' }),
  };
  return {
    services,
    value: createDeviceEnrollmentHandlers(
      { sessionStore } as never,
      config,
      services as never,
    ),
  };
}

describe('device enrollment HTTP boundary', () => {
  it('requires an authenticated same-origin source and returns a no-store grant', async () => {
    const { value, services } = handlers();
    const response = await value.createGrant(request('/api/auth/passkey/device-enrollment/grant'));
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      grantToken,
      expiresAt: '2026-07-20T00:05:00.000Z',
    });
    expect(services.beginEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({ sessionToken: 'source-session' }),
      expect.any(Object),
    );

    const crossOrigin = await value.createGrant(
      request('/api/auth/passkey/device-enrollment/grant', {
        headers: { origin: 'https://evil.example' },
      }),
    );
    expect(crossOrigin.status).toBe(403);
  });

  it('accepts the target grant only in a same-origin POST body', async () => {
    const { value, services } = handlers();
    const response = await value.options(
      request('/api/auth/passkey/device-enrollment/options', {
        body: JSON.stringify({ grantToken }),
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toContain(
      `portfolio_device_enrollment=${grantToken}`,
    );
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(services.getOptions).toHaveBeenCalledWith(
      grantToken,
      expect.any(Object),
    );
  });

  it('rejects non-canonical grant token lengths and characters', async () => {
    const { value, services } = handlers();
    for (const invalidToken of ['g'.repeat(42), `${'g'.repeat(42)}!`]) {
      const response = await value.options(
        request('/api/auth/passkey/device-enrollment/options', {
          body: JSON.stringify({ grantToken: invalidToken }),
        }),
      );
      expect(response.status).toBe(400);
    }
    expect(services.getOptions).not.toHaveBeenCalled();
  });

  it('sets a protected target session cookie after successful enrollment', async () => {
    const { value, services } = handlers();
    const response = await value.verify(
      request('/api/auth/passkey/device-enrollment/verify', {
        headers: { cookie: `portfolio_device_enrollment=${grantToken}` },
        body: JSON.stringify({ response: {} }),
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toContain('portfolio_session=target-session');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('Secure');
    expect(response.headers.get('set-cookie')).toContain('SameSite=strict');
    expect(services.finishEnrollment).toHaveBeenCalledWith(
      { grantToken, response: {} },
      expect.any(Object),
    );
  });
});
