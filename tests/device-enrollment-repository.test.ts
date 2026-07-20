import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import { createAuthRepository } from '@/auth/repository';
import { resolveSessionPrincipal } from '@/auth/session';
import { hashSessionToken } from '@/auth/session-token';
import type { AppDatabase } from '@/db/client';
import { applyAllMigrations } from './helpers/migrations';

async function setup() {
  const client = new PGlite();
  await applyAllMigrations(client);
  const now = new Date();
  const freshHash = hashSessionToken('fresh-session');
  const staleHash = hashSessionToken('stale-session');
  await client.query(
    `insert into "user" (id, name) values ('existing-user', 'Steffie')`,
  );
  const registrationHash = hashSessionToken('registration-session');
  await client.query(
    `insert into auth_sessions
       (user_id, token_hash, expires_at, auth_method, authenticated_at, created_at)
     values
       ('existing-user', $1, $4, 'passkey_authentication', $5, $5),
       ('existing-user', $2, $4, 'passkey_authentication', $6, $6),
       ('existing-user', $3, $4, 'passkey_registration', $5, $5)`,
    [
      freshHash,
      staleHash,
      registrationHash,
      new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      new Date(now.getTime() - 2 * 60 * 1000),
      new Date(now.getTime() - 10 * 60 * 1000),
    ],
  );
  await client.query(
    `insert into passkey_credentials
       (id, user_id, public_key, counter, device_type, backed_up, transports)
     values ('existing-credential', 'existing-user', '\\x010203', 0, 'singleDevice', false, array['internal'])`,
  );
  const repository = createAuthRepository(drizzle({ client }) as unknown as AppDatabase);
  return { client, repository, now, freshHash, staleHash, registrationHash };
}

describe('device enrollment repository', () => {
  it('stores a grant only for the principal recent session and loads existing-user context', async () => {
    const { client, repository, now, freshHash } = await setup();
    try {
      const principal = await resolveSessionPrincipal('fresh-session', repository.sessionStore, now);
      expect(principal).not.toBeNull();
      const expiresAt = await repository.saveDeviceEnrollmentGrant(
        principal!,
        freshHash,
        {
          tokenHash: 'grant-hash',
          challenge: 'grant-challenge',
        },
        now,
      );
      const storedGrant = await client.query<{ expires_at: Date; created_at: Date }>(
        `select expires_at, created_at
         from device_enrollment_grants where token_hash = 'grant-hash'`,
      );
      expect(expiresAt).toEqual(storedGrant.rows[0].expires_at);
      expect(
        storedGrant.rows[0].expires_at.getTime() - storedGrant.rows[0].created_at.getTime(),
      ).toBe(5 * 60 * 1000);

      await expect(repository.loadDeviceEnrollmentGrant('grant-hash', now)).resolves.toEqual({
        userId: 'existing-user',
        name: 'Steffie',
        challenge: 'grant-challenge',
        excludeCredentials: [{ id: 'existing-credential', transports: ['internal'] }],
      });

      const enrollment = {
        tokenHash: 'grant-hash',
        userId: 'existing-user',
        challenge: 'grant-challenge',
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
          expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
          authMethod: 'passkey_device_enrollment' as const,
          authenticatedAt: now,
        },
        now,
      };
      await repository.persistDeviceEnrollment(enrollment);
      await expect(repository.loadDeviceEnrollmentGrant('grant-hash', now)).resolves.toBeNull();
      await expect(repository.loadCredential('smartphone-credential')).resolves.toMatchObject({
        id: 'smartphone-credential',
        userId: 'existing-user',
      });
      await expect(
        repository.sessionStore.findActiveUserByTokenHash(
          hashSessionToken('smartphone-session'),
          now,
        ),
      ).resolves.toBe('existing-user');

      await expect(
        repository.persistDeviceEnrollment({
          ...enrollment,
          credential: { ...enrollment.credential, id: 'replay-credential' },
          session: {
            ...enrollment.session,
            tokenHash: hashSessionToken('replay-session'),
          },
        }),
      ).rejects.toThrow('already consumed');
      await expect(repository.loadCredential('replay-credential')).resolves.toBeNull();
      await expect(
        repository.sessionStore.findActiveUserByTokenHash(
          hashSessionToken('replay-session'),
          now,
        ),
      ).resolves.toBeNull();
      const users = await client.query<{ count: number }>(
        'select count(*)::int as count from "user"',
      );
      expect(users.rows).toEqual([{ count: 1 }]);
    } finally {
      await client.close();
    }
  });

  it('allows only one simultaneous consumption of the same grant', async () => {
    const { client, repository, now, freshHash } = await setup();
    try {
      const principal = await resolveSessionPrincipal('fresh-session', repository.sessionStore, now);
      await repository.saveDeviceEnrollmentGrant(
        principal!,
        freshHash,
        {
          tokenHash: 'race-grant-hash',
          challenge: 'race-challenge',
        },
        now,
      );
      const attempt = (suffix: string) =>
        repository.persistDeviceEnrollment({
          tokenHash: 'race-grant-hash',
          userId: 'existing-user',
          challenge: 'race-challenge',
          credential: {
            id: `race-credential-${suffix}`,
            userId: 'existing-user',
            publicKey: Buffer.from([7, 8, 9]),
            counter: 0,
            deviceType: 'multiDevice',
            backedUp: true,
          },
          session: {
            userId: 'existing-user',
            tokenHash: hashSessionToken(`race-session-${suffix}`),
            expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
            authMethod: 'passkey_device_enrollment' as const,
            authenticatedAt: now,
          },
          now,
        });

      const results = await Promise.allSettled([attempt('a'), attempt('b')]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      const credentials = await client.query<{ count: number }>(
        `select count(*)::int as count from passkey_credentials
         where id like 'race-credential-%'`,
      );
      const sessions = await client.query<{ count: number }>(
        `select count(*)::int as count from auth_sessions
         where token_hash in ($1, $2)`,
        [hashSessionToken('race-session-a'), hashSessionToken('race-session-b')],
      );
      expect(credentials.rows).toEqual([{ count: 1 }]);
      expect(sessions.rows).toEqual([{ count: 1 }]);
    } finally {
      await client.close();
    }
  });

  it('rejects a grant when the source session is older than five minutes', async () => {
    const { client, repository, now, staleHash } = await setup();
    try {
      const principal = await resolveSessionPrincipal('stale-session', repository.sessionStore, now);
      expect(principal).not.toBeNull();
      await expect(
        repository.saveDeviceEnrollmentGrant(
          principal!,
          staleHash,
          {
            tokenHash: 'stale-grant-hash',
            challenge: 'stale-grant-challenge',
            },
          now,
        ),
      ).rejects.toThrow('Recent user verification is required');
      await expect(
        repository.loadDeviceEnrollmentGrant('stale-grant-hash', now),
      ).resolves.toBeNull();
    } finally {
      await client.close();
    }
  });

  it('rejects a source authentication timestamp in the database future', async () => {
    const { client, repository, now, freshHash } = await setup();
    try {
      await client.query(
        `update auth_sessions
         set authenticated_at = CURRENT_TIMESTAMP + interval '1 hour'
         where token_hash = $1`,
        [freshHash],
      );
      const principal = await resolveSessionPrincipal('fresh-session', repository.sessionStore, now);
      expect(principal).not.toBeNull();
      await expect(
        repository.saveDeviceEnrollmentGrant(
          principal!,
          freshHash,
          {
            tokenHash: 'future-auth-grant-hash',
            challenge: 'future-auth-grant-challenge',
            },
          now,
        ),
      ).rejects.toThrow('Recent user verification is required');
    } finally {
      await client.close();
    }
  });

  it('rejects a grant expiry more than five database minutes after creation', async () => {
    const { client, repository, now, freshHash } = await setup();
    try {
      await expect(
        client.query(
          `insert into device_enrollment_grants
            (token_hash, user_id, source_session_id, purpose, challenge, expires_at)
           select 'overlong-grant-hash', 'existing-user', id, 'add_device',
                  'overlong-grant-challenge', CURRENT_TIMESTAMP + interval '1 hour'
           from auth_sessions where token_hash = $1`,
          [freshHash],
        ),
      ).rejects.toThrow();
      await expect(
        repository.loadDeviceEnrollmentGrant('overlong-grant-hash', now),
      ).resolves.toBeNull();
    } finally {
      await client.close();
    }
  });

  it('rejects a newly registered session that was not a passkey re-authentication', async () => {
    const { client, repository, now, registrationHash } = await setup();
    try {
      const principal = await resolveSessionPrincipal(
        'registration-session',
        repository.sessionStore,
        now,
      );
      expect(principal).not.toBeNull();
      await expect(
        repository.saveDeviceEnrollmentGrant(
          principal!,
          registrationHash,
          {
            tokenHash: 'registration-grant-hash',
            challenge: 'registration-grant-challenge',
            },
          now,
        ),
      ).rejects.toThrow('Recent user verification is required');
    } finally {
      await client.close();
    }
  });

  it('revokes an unused grant when its source session is revoked', async () => {
    const { client, repository, now, freshHash } = await setup();
    try {
      const principal = await resolveSessionPrincipal('fresh-session', repository.sessionStore, now);
      await repository.saveDeviceEnrollmentGrant(
        principal!,
        freshHash,
        {
          tokenHash: 'revoked-grant-hash',
          challenge: 'revoked-grant-challenge',
        },
        now,
      );
      await client.query('delete from auth_sessions where token_hash = $1', [freshHash]);
      await expect(
        repository.loadDeviceEnrollmentGrant('revoked-grant-hash', now),
      ).resolves.toBeNull();
    } finally {
      await client.close();
    }
  });


  it('rejects options and final consumption after the source session expires', async () => {
    const { client, repository, now, freshHash } = await setup();
    try {
      const principal = await resolveSessionPrincipal('fresh-session', repository.sessionStore, now);
      await repository.saveDeviceEnrollmentGrant(
        principal!,
        freshHash,
        {
          tokenHash: 'source-expired-grant-hash',
          challenge: 'source-expired-challenge',
        },
        now,
      );
      await client.query(
        `update auth_sessions
         set expires_at = CURRENT_TIMESTAMP - interval '1 minute'
         where token_hash = $1`,
        [freshHash],
      );

      await expect(
        repository.loadDeviceEnrollmentGrant('source-expired-grant-hash', now),
      ).resolves.toBeNull();
      await expect(
        repository.persistDeviceEnrollment({
          tokenHash: 'source-expired-grant-hash',
          userId: 'existing-user',
          challenge: 'source-expired-challenge',
          credential: {
            id: 'source-expired-credential',
            userId: 'existing-user',
            publicKey: Buffer.from([9]),
            counter: 0,
            deviceType: 'multiDevice',
            backedUp: true,
          },
          session: {
            userId: 'existing-user',
            tokenHash: hashSessionToken('source-expired-target-session'),
            expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
            authMethod: 'passkey_device_enrollment',
            authenticatedAt: now,
          },
          now,
        }),
      ).rejects.toThrow('already consumed');
      await expect(repository.loadCredential('source-expired-credential')).resolves.toBeNull();
    } finally {
      await client.close();
    }
  });

  it('rolls back grant consumption when credential insertion fails', async () => {
    const { client, repository, now, freshHash } = await setup();
    try {
      const principal = await resolveSessionPrincipal('fresh-session', repository.sessionStore, now);
      await repository.saveDeviceEnrollmentGrant(
        principal!,
        freshHash,
        {
          tokenHash: 'rollback-grant-hash',
          challenge: 'rollback-challenge',
        },
        now,
      );
      await expect(
        repository.persistDeviceEnrollment({
          tokenHash: 'rollback-grant-hash',
          userId: 'existing-user',
          challenge: 'rollback-challenge',
          credential: {
            id: 'existing-credential',
            userId: 'existing-user',
            publicKey: Buffer.from([9]),
            counter: 0,
            deviceType: 'multiDevice',
            backedUp: true,
          },
          session: {
            userId: 'existing-user',
            tokenHash: hashSessionToken('rollback-session'),
            expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
            authMethod: 'passkey_device_enrollment',
            authenticatedAt: now,
          },
          now,
        }),
      ).rejects.toThrow();
      await expect(
        repository.loadDeviceEnrollmentGrant('rollback-grant-hash', now),
      ).resolves.toMatchObject({ challenge: 'rollback-challenge' });
      await expect(
        repository.sessionStore.findActiveUserByTokenHash(
          hashSessionToken('rollback-session'),
          now,
        ),
      ).resolves.toBeNull();
    } finally {
      await client.close();
    }
  });

  it('uses database time to reject a grant expired before the final transaction', async () => {
    const { client, repository, now, freshHash } = await setup();
    try {
      const sessions = await client.query<{ id: string }>(
        'select id from auth_sessions where token_hash = $1',
        [freshHash],
      );
      await client.query(
        `insert into device_enrollment_grants
          (token_hash, user_id, source_session_id, purpose, challenge, expires_at, created_at)
         values ($1, 'existing-user', $2, 'add_device', $3, $4, $5)`,
        [
          'expired-at-commit-hash',
          sessions.rows[0].id,
          'expired-at-commit-challenge',
          new Date(Date.now() - 60_000),
          new Date(Date.now() - 2 * 60_000),
        ],
      );
      await expect(
        repository.persistDeviceEnrollment({
          tokenHash: 'expired-at-commit-hash',
          userId: 'existing-user',
          challenge: 'expired-at-commit-challenge',
          credential: {
            id: 'expired-credential',
            userId: 'existing-user',
            publicKey: Buffer.from([9]),
            counter: 0,
            deviceType: 'multiDevice',
            backedUp: true,
          },
          session: {
            userId: 'existing-user',
            tokenHash: hashSessionToken('expired-session'),
            expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
            authMethod: 'passkey_device_enrollment',
            authenticatedAt: now,
          },
          now: new Date('2000-01-01T00:00:00Z'),
        }),
      ).rejects.toThrow('already consumed');
      await expect(repository.loadCredential('expired-credential')).resolves.toBeNull();
    } finally {
      await client.close();
    }
  });

});
