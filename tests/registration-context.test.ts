import { describe, expect, it } from 'vitest';
import {
  createRegistrationContext,
  verifyRegistrationContext,
} from '@/auth/registration-context';

describe('passkey registration context', () => {
  it('round-trips an authenticated server-generated identity', () => {
    const token = createRegistrationContext(
      { userId: 'user-1', name: 'Steffie', expiresAt: 2_000 },
      'test-secret-with-enough-entropy',
    );

    expect(
      verifyRegistrationContext(token, 'test-secret-with-enough-entropy', 1_000),
    ).toEqual({ userId: 'user-1', name: 'Steffie', expiresAt: 2_000 });
  });

  it('rejects an expired context', () => {
    const token = createRegistrationContext(
      { userId: 'user-1', name: 'Steffie', expiresAt: 2_000 },
      'test-secret-with-enough-entropy',
    );

    expect(() =>
      verifyRegistrationContext(token, 'test-secret-with-enough-entropy', 2_001),
    ).toThrow('Expired registration context');
  });

  it('rejects an empty server-generated identity', () => {
    expect(() =>
      createRegistrationContext(
        { userId: '', name: '   ', expiresAt: 2_000 },
        'test-secret-with-enough-entropy',
      ),
    ).toThrow('Invalid registration context');
  });
});
