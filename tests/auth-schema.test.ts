import { getTableColumns, getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  authChallenges,
  authSessions,
  authUsers,
  passkeyCredentials,
} from '@/db/schema';

describe('passkey authentication schema', () => {
  it('stores only a hash of each session token', () => {
    expect(getTableName(authSessions)).toBe('auth_sessions');
    const columns = getTableColumns(authSessions);
    expect(columns.tokenHash.name).toBe('token_hash');
    expect('token' in columns).toBe(false);
  });

  it('stores WebAuthn credential state and expiring challenges', () => {
    expect(getTableName(passkeyCredentials)).toBe('passkey_credentials');
    expect(getTableColumns(passkeyCredentials).publicKey.name).toBe('public_key');
    expect(getTableColumns(passkeyCredentials).counter.name).toBe('counter');
    expect(getTableName(authChallenges)).toBe('auth_challenges');
    expect(getTableColumns(authChallenges).expiresAt.name).toBe('expires_at');
    expect(getTableColumns(authChallenges).contextHash.notNull).toBe(true);
  });

  it('records when an account deletion was requested', () => {
    expect(getTableColumns(authUsers).deletionRequestedAt.name).toBe(
      'deletion_requested_at',
    );
  });

  it('stores the display name required for passkey onboarding', () => {
    const columns = getTableColumns(authUsers);
    expect(columns.name.name).toBe('name');
    expect(columns.name.notNull).toBe(true);
    expect(columns.createdAt.name).toBe('created_at');
  });
});
