// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/pglite';
import type { AppDatabase } from '@/db/client';
import { resolveSessionPrincipal, type AuthenticatedPrincipal } from '@/auth/session';
import { createGardenRepository } from '@/garden/repository';
import { applyAllMigrations } from './helpers/migrations';

describe('garden owner state migration', () => {
  it('persists only opaque-principal state and atomically rejects stale competing corrections', async () => {
    const client = new PGlite();
    try {
      await client.exec('create role portfolio_app nologin; grant usage on schema public to portfolio_app;');
      await applyAllMigrations(client);
      await client.exec(`insert into "user" (id, name) values ('garden-a', 'Synthetic A'), ('garden-b', 'Synthetic B'); set role portfolio_app;`);
      const repository = createGardenRepository(drizzle({ client }) as unknown as AppDatabase);
      const a = (await resolveSessionPrincipal('a', { findActiveUserByTokenHash: async () => 'garden-a' }))!;
      const b = (await resolveSessionPrincipal('b', { findActiveUserByTokenHash: async () => 'garden-b' }))!;
      await expect(repository.load(a)).resolves.toEqual({ revision: 0, lots: [] });
      await expect(repository.save(a, { revision: 0, lots: [] })).resolves.toEqual({ revision: 1, lots: [] });
      await expect(repository.load(b)).resolves.toEqual({ revision: 0, lots: [] });
      await expect(repository.save(a, { revision: 0, lots: [] })).rejects.toThrow('Stale garden revision');
      const attempts = await Promise.allSettled([repository.save(a, { revision: 1, lots: [] }), repository.save(a, { revision: 1, lots: [] })]);
      expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(attempts.filter(result => result.status === 'rejected')).toHaveLength(1);
      await expect(repository.load(a)).resolves.toEqual({ revision: 2, lots: [] });
      await expect(repository.load({ __authenticatedPrincipal: true } as AuthenticatedPrincipal)).rejects.toThrow('Invalid authenticated principal');
      await expect(repository.save(a, { revision: 2, lots: [], ownerUserId: 'garden-b' } as never)).rejects.toThrow('Invalid garden');
      expect((await client.query('select * from garden_states')).rows).toEqual([]);
    } finally { await client.close(); }
  }, 30_000);

  it('adds a forced-RLS table and least privilege grants without touching existing holdings', async () => {
    const client = new PGlite();
    try {
      await client.exec('create role portfolio_app nologin; grant usage on schema public to portfolio_app;');
      await applyAllMigrations(client);
      const catalog = await client.query(`select relrowsecurity, relforcerowsecurity from pg_class where relname = 'garden_states'`);
      expect(catalog.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
      const acl = await client.query(`select has_table_privilege('portfolio_app', 'garden_states', 'SELECT, INSERT, UPDATE') as writable,
        has_table_privilege('portfolio_app', 'garden_states', 'DELETE') as deletable`);
      expect(acl.rows).toEqual([{ writable: true, deletable: false }]);
      await client.exec(`insert into "user" (id, name) values ('garden-a', 'Synthetic A'), ('garden-b', 'Synthetic B');
        insert into garden_states (owner_user_id, revision, lots) values ('garden-b', 1, '[]'); set role portfolio_app;`);
      expect((await client.query('select * from garden_states')).rows).toEqual([]);
      await client.exec(`select set_config('app.current_user_id', 'garden-a', false);`);
      await expect(client.exec(`insert into garden_states (owner_user_id, revision, lots) values ('garden-b', 2, '[]')`)).rejects.toMatchObject({ code: '42501' });
    } finally { await client.close(); }
  }, 30_000);
});
