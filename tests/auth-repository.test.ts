import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import { createAuthRepository } from '@/auth/repository';
import { resolveSessionPrincipal } from '@/auth/session';
import { hashSessionToken } from '@/auth/session-token';
import type { AppDatabase } from '@/db/client';
import { applyAllMigrations } from './helpers/migrations';

describe('authentication repository', () => {
  it('persists registration atomically and revokes sessions on deletion request', async () => {
    const client = new PGlite();
    try {
      await applyAllMigrations(client);
      const db = drizzle({ client }) as unknown as AppDatabase;
      const repository = createAuthRepository(db);
      const now = new Date('2026-07-17T12:00:00Z');
      await repository.saveChallenge({
        challenge: 'challenge-1',
        ceremony: 'registration',
        contextHash: 'context-hash',
        expiresAt: new Date('2026-07-17T12:05:00Z'),
      });
      expect(
        await repository.loadRegistrationChallenge('context-hash', now),
      ).toEqual({ challenge: 'challenge-1' });

      await repository.persistRegistration({
        user: { id: 'user-1', name: 'Steffie' },
        credential: {
          id: 'credential-1',
          userId: 'user-1',
          publicKey: Buffer.from([1, 2, 3]),
          counter: 0,
          deviceType: 'multiDevice',
          backedUp: true,
          transports: ['internal'],
        },
        session: {
          userId: 'user-1',
          tokenHash: hashSessionToken('session-token'),
          expiresAt: new Date('2026-08-17T12:00:00Z'),
          authMethod: 'passkey_registration',
          authenticatedAt: now,
        },
        contextHash: 'context-hash',
        now,
      });

      await expect(
        repository.sessionStore.findActiveUserByTokenHash(hashSessionToken('session-token'), now),
      ).resolves.toBe('user-1');
      await expect(
        repository.persistRegistration({
          user: { id: 'user-2', name: 'Replay' },
          credential: {
            id: 'credential-2',
            userId: 'user-2',
            publicKey: Buffer.from([4, 5, 6]),
            counter: 0,
            deviceType: 'multiDevice',
            backedUp: true,
          },
          session: {
            userId: 'user-2',
            tokenHash: 'replay-token-hash',
            expiresAt: new Date('2026-08-17T12:00:00Z'),
            authMethod: 'passkey_registration',
            authenticatedAt: now,
          },
          contextHash: 'context-hash',
          now,
        }),
      ).rejects.toThrow('already consumed');
      await expect(
        repository.sessionStore.findActiveUserByTokenHash('replay-token-hash', now),
      ).resolves.toBeNull();
      await repository.saveChallenge({
        challenge: 'auth-challenge',
        ceremony: 'authentication',
        contextHash: 'auth-context-hash',
        expiresAt: new Date('2026-07-17T12:05:00Z'),
      });
      const beforeAuthentication = await client.query<{ now: Date }>(
        'select CURRENT_TIMESTAMP as now',
      );
      const authentication = {
        credentialId: 'credential-1',
        previousCounter: 0,
        newCounter: 1,
        userId: 'user-1',
        tokenHash: hashSessionToken('second-session'),
        expiresAt: new Date('2026-08-17T12:00:00Z'),
        contextHash: 'auth-context-hash',
        authMethod: 'passkey_authentication' as const,
        authenticatedAt: new Date('2099-01-01T00:00:00Z'),
        now,
      };
      await repository.persistAuthentication(authentication);
      const afterAuthentication = await client.query<{ now: Date }>(
        'select CURRENT_TIMESTAMP as now',
      );
      const persistedAuthentication = await client.query<{ authenticated_at: Date }>(
        `select authenticated_at from auth_sessions where token_hash = $1`,
        [authentication.tokenHash],
      );
      expect(persistedAuthentication.rows[0].authenticated_at.getTime()).toBeGreaterThanOrEqual(
        beforeAuthentication.rows[0].now.getTime(),
      );
      expect(persistedAuthentication.rows[0].authenticated_at.getTime()).toBeLessThanOrEqual(
        afterAuthentication.rows[0].now.getTime(),
      );
      await expect(
        repository.persistAuthentication({
          ...authentication,
          previousCounter: 1,
          newCounter: 2,
          tokenHash: hashSessionToken('replayed-session'),
        }),
      ).rejects.toThrow('already consumed');
      await expect(
        repository.sessionStore.findActiveUserByTokenHash(
          hashSessionToken('replayed-session'),
          now,
        ),
      ).resolves.toBeNull();
      const principal = await resolveSessionPrincipal(
        'session-token',
        repository.sessionStore,
        now,
      );
      expect(principal).not.toBeNull();
      await repository.requestAccountDeletion(principal!, now);
      await expect(
        repository.sessionStore.findActiveUserByTokenHash(hashSessionToken('session-token'), now),
      ).resolves.toBeNull();
      await expect(repository.loadCredential('credential-1')).resolves.toBeNull();
    } finally {
      await client.close();
    }
  });
});
