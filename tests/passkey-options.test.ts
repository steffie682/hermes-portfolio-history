import { describe, expect, it } from 'vitest';
import {
  createPasskeyAuthenticationOptions,
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

  it('requires user verification for discoverable sign-in', async () => {
    const options = await createPasskeyAuthenticationOptions({ rpID: 'localhost' });
    expect(options.rpId).toBe('localhost');
    expect(options.userVerification).toBe('required');
    expect(options.allowCredentials).toBeUndefined();
  });
});
