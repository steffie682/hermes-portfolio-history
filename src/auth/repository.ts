import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import type { AppDatabase } from '@/db/client';
import {
  authChallenges,
  authSessions,
  authUsers,
  brokerAccounts,
  passkeyCredentials,
} from '@/db/schema';
import {
  authenticatedPrincipalId,
  type AuthenticatedPrincipal,
  type SessionStore,
} from './session';
import type { ChallengeRecord, PersistRegistrationInput } from './passkey-registration';
import type { StoredPasskey } from './passkey-authentication';

export function createAuthRepository(db: AppDatabase) {
  async function withPrincipal<T>(
    principal: AuthenticatedPrincipal,
    operation: (
      tx: Parameters<Parameters<AppDatabase['transaction']>[0]>[0],
    ) => Promise<T>,
  ) {
    const userId = authenticatedPrincipalId(principal);
    return db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_user_id', ${userId}, true)`);
      return operation(tx);
    });
  }

  const loadChallenge = (ceremony: 'registration' | 'authentication') =>
    async (contextHash: string, now: Date) => {
      const [row] = await db
        .select({ challenge: authChallenges.challenge })
        .from(authChallenges)
        .where(
          and(
            eq(authChallenges.contextHash, contextHash),
            eq(authChallenges.ceremony, ceremony),
            gt(authChallenges.expiresAt, now),
          ),
        )
        .limit(1);
      return row ?? null;
    };

  return {
    async saveChallenge(record: ChallengeRecord) {
      await db.transaction(async (tx) => {
        await tx
          .delete(authChallenges)
          .where(lt(authChallenges.expiresAt, new Date()));
        await tx.insert(authChallenges).values(record);
      });
    },
    loadRegistrationChallenge: loadChallenge('registration'),
    loadAuthenticationChallenge: loadChallenge('authentication'),
    async persistRegistration(input: PersistRegistrationInput) {
      await db.transaction(async (tx) => {
        const consumed = await tx
          .delete(authChallenges)
          .where(
            and(
              eq(authChallenges.contextHash, input.contextHash),
              eq(authChallenges.ceremony, 'registration'),
              gt(authChallenges.expiresAt, input.now),
            ),
          )
          .returning({ id: authChallenges.id });
        if (consumed.length !== 1) {
          throw new Error('Registration challenge was already consumed');
        }
        await tx.insert(authUsers).values(input.user);
        await tx.insert(passkeyCredentials).values({
          ...input.credential,
          publicKey: Uint8Array.from(input.credential.publicKey) as Buffer,
        });
        await tx.insert(authSessions).values(input.session);
      });
    },
    async loadCredential(credentialId: string): Promise<StoredPasskey | null> {
      const [row] = await db
        .select({
          id: passkeyCredentials.id,
          userId: passkeyCredentials.userId,
          publicKey: passkeyCredentials.publicKey,
          counter: passkeyCredentials.counter,
          transports: passkeyCredentials.transports,
        })
        .from(passkeyCredentials)
        .innerJoin(authUsers, eq(authUsers.id, passkeyCredentials.userId))
        .where(
          and(
            eq(passkeyCredentials.id, credentialId),
            isNull(authUsers.deletionRequestedAt),
          ),
        )
        .limit(1);
      if (!row) return null;
      return {
        ...row,
        publicKey: Uint8Array.from(row.publicKey),
        transports: row.transports as StoredPasskey['transports'],
      };
    },
    async persistAuthentication(input: {
      credentialId: string;
      previousCounter: number;
      newCounter: number;
      userId: string;
      tokenHash: string;
      expiresAt: Date;
      contextHash: string;
      now: Date;
    }) {
      await db.transaction(async (tx) => {
        const consumed = await tx
          .delete(authChallenges)
          .where(
            and(
              eq(authChallenges.contextHash, input.contextHash),
              eq(authChallenges.ceremony, 'authentication'),
              gt(authChallenges.expiresAt, input.now),
            ),
          )
          .returning({ id: authChallenges.id });
        if (consumed.length !== 1) {
          throw new Error('Authentication challenge was already consumed');
        }
        const updated = await tx
          .update(passkeyCredentials)
          .set({ counter: input.newCounter })
          .where(
            and(
              eq(passkeyCredentials.id, input.credentialId),
              eq(passkeyCredentials.userId, input.userId),
              eq(passkeyCredentials.counter, input.previousCounter),
            ),
          )
          .returning({ id: passkeyCredentials.id });
        if (updated.length !== 1) {
          throw new Error('Passkey counter changed concurrently');
        }
        await tx.insert(authSessions).values({
          userId: input.userId,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
        });
      });
    },
    sessionStore: {
      async findActiveUserByTokenHash(tokenHash: string, now: Date) {
        const [row] = await db
          .select({ userId: authSessions.userId })
          .from(authSessions)
          .innerJoin(authUsers, eq(authUsers.id, authSessions.userId))
          .where(
            and(
              eq(authSessions.tokenHash, tokenHash),
              gt(authSessions.expiresAt, now),
              isNull(authUsers.deletionRequestedAt),
            ),
          )
          .limit(1);
        return row?.userId ?? null;
      },
    } satisfies SessionStore,
    async requestAccountDeletion(principal: AuthenticatedPrincipal, now: Date) {
      const userId = authenticatedPrincipalId(principal);
      await db.transaction(async (tx) => {
        await tx
          .update(authUsers)
          .set({ deletionRequestedAt: now })
          .where(eq(authUsers.id, userId));
        await tx.delete(authSessions).where(eq(authSessions.userId, userId));
      });
    },
    async listBrokerAccounts(principal: AuthenticatedPrincipal) {
      return withPrincipal(principal, (tx) =>
        tx
          .select({
            id: brokerAccounts.id,
            broker: brokerAccounts.broker,
            displayName: brokerAccounts.displayName,
          })
          .from(brokerAccounts)
          .orderBy(brokerAccounts.createdAt),
      );
    },
    async getBrokerAccount(principal: AuthenticatedPrincipal, id: string) {
      return withPrincipal(principal, async (tx) => {
        const [row] = await tx
          .select({
            id: brokerAccounts.id,
            broker: brokerAccounts.broker,
            displayName: brokerAccounts.displayName,
          })
          .from(brokerAccounts)
          .where(eq(brokerAccounts.id, id))
          .limit(1);
        return row ?? null;
      });
    },
    async createBrokerAccount(
      principal: AuthenticatedPrincipal,
      input: { broker: string; displayName: string },
    ) {
      const ownerUserId = authenticatedPrincipalId(principal);
      return withPrincipal(principal, async (tx) => {
        const [row] = await tx
          .insert(brokerAccounts)
          .values({ ownerUserId, broker: input.broker, displayName: input.displayName })
          .returning({
            id: brokerAccounts.id,
            broker: brokerAccounts.broker,
            displayName: brokerAccounts.displayName,
          });
        return row;
      });
    },
  };
}
