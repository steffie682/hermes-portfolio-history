import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import { verifyRuntimeRole } from '@/db/security';
import type { AppDatabase } from '@/db/client';
import { migrationDirectories } from './helpers/migrations';

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const postgresDescribe = adminUrl ? describe : describe.skip;

postgresDescribe('real PostgreSQL tenant security', () => {
  it('applies migrations and enforces RLS for the least-privilege runtime role', async () => {
    const adminTarget = new URL(adminUrl!);
    if (adminTarget.pathname !== '/portfolio_history_test') {
      throw new Error('Real PostgreSQL integration requires portfolio_history_test');
    }
    const admin = postgres(adminTarget.toString(), { max: 1 });
    const appUrl = new URL(adminTarget);
    appUrl.username = 'portfolio_app';
    appUrl.password = 'test-only-password';
    const app = postgres(appUrl.toString(), { max: 1 });
    try {
      for (const directory of await migrationDirectories()) {
        const migration = await readFile(
          resolve(process.cwd(), 'drizzle', directory, 'migration.sql'),
          'utf8',
        );
        for (const statement of migration.split('--> statement-breakpoint')) {
          if (statement.trim()) await admin.unsafe(statement);
        }
      }
      for (const statement of [
        `CREATE ROLE portfolio_app LOGIN PASSWORD 'test-only-password'
          NOSUPERUSER NOBYPASSRLS`,
        'GRANT CONNECT ON DATABASE portfolio_history_test TO portfolio_app',
        'GRANT USAGE ON SCHEMA public TO portfolio_app',
        'GRANT SELECT ON "user", auth_sessions TO portfolio_app',
        'GRANT SELECT, INSERT, UPDATE, DELETE ON broker_accounts TO portfolio_app',
        `INSERT INTO "user" (id, name)
          VALUES ('user-a', 'User A'), ('user-b', 'User B')`,
        `INSERT INTO broker_accounts (owner_user_id, broker, display_name)
          VALUES ('user-a', 'sbi', 'A account'), ('user-b', 'sbi', 'B account')`,
      ]) {
        await admin.unsafe(statement);
      }

      await verifyRuntimeRole(drizzle({ client: app }) as AppDatabase);
      await app.begin(async (tx) => {
        await tx`select set_config('app.current_user_id', 'user-a', true)`;
        const rows = await tx<{ owner_user_id: string }[]>`
          select owner_user_id from broker_accounts
        `;
        expect(rows).toEqual([{ owner_user_id: 'user-a' }]);
      });
      await expect(
        app.begin(async (tx) => {
          await tx`select set_config('app.current_user_id', 'user-a', true)`;
          await tx`
            insert into broker_accounts (owner_user_id, broker, display_name)
            values ('user-b', 'sbi', 'spoofed')
          `;
        }),
      ).rejects.toMatchObject({ code: '42501' });

      const [catalog] = await admin<{ relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
        select relrowsecurity, relforcerowsecurity
        from pg_class where relname = 'broker_accounts'
      `;
      expect(catalog).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    } finally {
      await app.end();
      await admin.end();
    }
  }, 30_000);
});
