import { describe, expect, it } from 'vitest';
import {
  createPasskeyAuthenticationOptions,
  createPasskeyDeviceEnrollmentOptions,
  createPasskeyRegistrationOptions,
} from '@/auth/passkey-options';

describe('passkey ceremony options', () => {
  it('requires a discoverable credential with user verification', async () => {
    const options = await createPasskeyRegistrationOptions(
      { rpID: 'localhost', rpName: '資産履歴管理' },
      { userId: 'user-1', name: 'Steffie' },
    );

    expect(options.rp.id).toBe('localhost');
    expect(options.user.displayName).toBe('Steffie');
    expect(options.authenticatorSelection).toMatchObject({
      residentKey: 'required',
      userVerification: 'required',
    });
    expect(options.attestation).toBe('none');
  });

  it('binds add-device options to the existing user and enrollment challenge', async () => {
    const options = await createPasskeyDeviceEnrollmentOptions(
      { rpID: 'localhost', rpName: '資産履歴管理' },
      {
        userId: 'existing-user',
        name: 'Steffie',
        challenge: 'enrollment-challenge',
        excludeCredentials: [{ id: 'credential-1', transports: ['internal'] }],
      },
    );

    expect(options.challenge).toBe('enrollment-challenge');
    expect(options.user.id).toBe('ZXhpc3RpbmctdXNlcg');
    expect(options.user.displayName).toBe('Steffie');
    expect(options.excludeCredentials).toEqual([
      { id: 'credential-1', type: 'public-key', transports: ['internal'] },
    ]);
  });

  it('requires user verification for discoverable sign-in', async () => {
    const options = await createPasskeyAuthenticationOptions({ rpID: 'localhost' });
    expect(options.rpId).toBe('localhost');
    expect(options.userVerification).toBe('required');
    expect(options.allowCredentials).toBeUndefined();
  });
});
