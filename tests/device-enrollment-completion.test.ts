import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { describe, expect, it, vi } from 'vitest';
import {
  finishDeviceEnrollment,
  getDeviceEnrollmentOptions,
} from '@/auth/device-enrollment';
import { hashSessionToken } from '@/auth/session-token';
import type { AuthConfig } from '@/auth/types';

const config: AuthConfig = {
  secret: 'a'.repeat(32),
  origin: 'https://portfolio.example',
  rpID: 'portfolio.example',
  rpName: '資産履歴管理',
  secureCookies: true,
};

const grant = {
  userId: 'existing-user',
  name: 'Steffie',
  challenge: 'enrollment-challenge',
  excludeCredentials: [{ id: 'credential-1', transports: ['internal'] as const }],
};

describe('device enrollment completion', () => {
  it('loads a grant only by hash and returns options for the existing user', async () => {
    const loadGrant = vi.fn().mockResolvedValue(grant);
    const options = await getDeviceEnrollmentOptions('raw-grant-token', {
      config,
      loadGrant,
      now: new Date('2026-07-20T00:01:00Z'),
    });

    expect(loadGrant).toHaveBeenCalledWith(
      hashSessionToken('raw-grant-token'),
      new Date('2026-07-20T00:01:00Z'),
    );
    expect(options.challenge).toBe('enrollment-challenge');
    expect(options.user.id).toBe('ZXhpc3RpbmctdXNlcg');
    expect(options.user.displayName).toBe('Steffie');
  });

  it('adds a credential and target session to the existing user without creating a user', async () => {
    const now = new Date('2026-07-20T00:02:00Z');
    const loadGrant = vi.fn().mockResolvedValue(grant);
    const verifyRegistration = vi.fn().mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: 'smartphone-credential',
          publicKey: new Uint8Array([4, 5, 6]),
          counter: 0,
          transports: ['internal'],
        },
        credentialDeviceType: 'multiDevice',
        credentialBackedUp: true,
      },
    });
    const persistEnrollment = vi.fn().mockResolvedValue(undefined);

    const result = await finishDeviceEnrollment(
      { grantToken: 'raw-grant-token', response: {} as RegistrationResponseJSON },
      {
        config,
        now,
        loadGrant,
        verifyRegistration,
        persistEnrollment,
        createSessionToken: () => 'smartphone-session',
      },
    );

    expect(verifyRegistration).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedChallenge: 'enrollment-challenge',
        expectedOrigin: config.origin,
        expectedRPID: config.rpID,
        requireUserVerification: true,
      }),
    );
    expect(persistEnrollment).toHaveBeenCalledWith({
      tokenHash: hashSessionToken('raw-grant-token'),
      userId: 'existing-user',
      challenge: 'enrollment-challenge',
      credential: {
        id: 'smartphone-credential',
        userId: 'existing-user',
        publicKey: Buffer.from([4, 5, 6]),
        counter: 0,
        deviceType: 'multiDevice',
        backedUp: true,
        transports: ['internal'],
      },
      session: {
        userId: 'existing-user',
        tokenHash: hashSessionToken('smartphone-session'),
        expiresAt: new Date('2026-08-19T00:02:00Z'),
        authMethod: 'passkey_device_enrollment',
        authenticatedAt: now,
      },
      now,
    });
    expect(result).toEqual({ sessionToken: 'smartphone-session' });
  });

  it('rejects an expired or consumed grant before WebAuthn verification', async () => {
    const verifyRegistration = vi.fn();
    await expect(
      finishDeviceEnrollment(
        { grantToken: 'expired-token', response: {} as RegistrationResponseJSON },
        {
          config,
          loadGrant: vi.fn().mockResolvedValue(null),
          verifyRegistration,
          persistEnrollment: vi.fn(),
        },
      ),
    ).rejects.toThrow('Device enrollment grant is missing or expired');
    expect(verifyRegistration).not.toHaveBeenCalled();
  });
});
