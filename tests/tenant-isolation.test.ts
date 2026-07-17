import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { applyAllMigrations } from './helpers/migrations';

describe('PostgreSQL row-level security', () => {
  it('shows an application role only rows owned by the session user', async () => {
    const db = new PGlite();
    try {
      await applyAllMigrations(db);
      const rls = await db.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        `select relrowsecurity, relforcerowsecurity from pg_class where relname = 'broker_accounts'`,
      );
      expect(rls.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
      await db.exec(`
        insert into "user" (id, name) values ('user-a', 'User A'), ('user-b', 'User B');
        insert into broker_accounts (owner_user_id, broker, display_name)
        values ('user-a', 'sbi', 'A account'), ('user-b', 'sbi', 'B account');
        create role portfolio_app nologin;
        grant select, insert, update, delete on broker_accounts to portfolio_app;
        set role portfolio_app;
        select set_config('app.current_user_id', 'user-a', false);
      `);

      const visible = await db.query<{ owner_user_id: string }>(
        'select owner_user_id from broker_accounts order by owner_user_id',
      );
      expect(visible.rows).toEqual([{ owner_user_id: 'user-a' }]);
    } finally {
      await db.close();
    }
  });
});
