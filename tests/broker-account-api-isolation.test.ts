import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { createAuthRepository } from '@/auth/repository';
import { hashSessionToken } from '@/auth/session-token';
import { createBrokerAccountHandlers } from '@/broker-accounts/http';
import type { AppDatabase } from '@/db/client';
import { applyAllMigrations } from './helpers/migrations';

const userBAccountId = '22222222-2222-4222-8222-222222222222';

describe('broker account API tenant isolation', () => {
  it('derives ownership from the session and hides another user URL identifier', async () => {
    const client = new PGlite();
    try {
      await applyAllMigrations(client);
      await client.exec(`
        insert into "user" (id, name) values ('user-a', 'User A'), ('user-b', 'User B');
        insert into auth_sessions (user_id, token_hash, expires_at)
        values ('user-a', '${hashSessionToken('token-a')}', '2027-01-01T00:00:00Z');
        insert into broker_accounts (id, owner_user_id, broker, display_name)
        values ('${userBAccountId}', 'user-b', 'sbi', 'B account');
        create role portfolio_app nologin;
        grant usage on schema public to portfolio_app;
        grant select on "user", auth_sessions to portfolio_app;
        grant select, insert, update, delete on broker_accounts to portfolio_app;
        set role portfolio_app;
      `);
      const db = drizzle({ client }) as unknown as AppDatabase;
      const handlers = createBrokerAccountHandlers(createAuthRepository(db), 'http://localhost');
      const cookie = { cookie: 'portfolio_session=token-a' };

      const createResponse = await handlers.create(
        new NextRequest('http://localhost/api/broker-accounts', {
          method: 'POST',
          headers: {
            ...cookie,
            'content-type': 'application/json',
            origin: 'http://localhost',
          },
          body: JSON.stringify({
            broker: 'sbi',
            displayName: 'A account',
            ownerUserId: 'user-b',
          }),
        }),
      );
      expect(createResponse.status).toBe(201);

      const listResponse = await handlers.list(
        new NextRequest('http://localhost/api/broker-accounts', { headers: cookie }),
      );
      const listBody = (await listResponse.json()) as {
        accounts: Array<{ displayName: string }>;
      };
      expect(listBody.accounts.map((account) => account.displayName)).toEqual([
        'A account',
      ]);

      const crossTenantResponse = await handlers.get(
        new NextRequest(`http://localhost/api/broker-accounts/${userBAccountId}`, {
          headers: cookie,
        }),
        userBAccountId,
      );
      expect(crossTenantResponse.status).toBe(404);

      await client.exec(`select set_config('app.current_user_id', 'user-a', false);`);
      const visible = await client.query<{ owner_user_id: string }>(
        'select owner_user_id from broker_accounts order by owner_user_id',
      );
      expect(visible.rows).toEqual([{ owner_user_id: 'user-a' }]);
    } finally {
      await client.close();
    }
  }, 15_000);
});
