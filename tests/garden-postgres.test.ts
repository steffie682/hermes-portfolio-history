// @vitest-environment node
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { describe, expect, it } from 'vitest';
import { resolveSessionPrincipal } from '@/auth/session';
import { createGardenRepository } from '@/garden/repository';
import type { AppDatabase } from '@/db/client';
import { migrationDirectories } from './helpers/migrations';

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
(adminUrl ? describe : describe.skip)('garden real PostgreSQL CAS', () => {
  it('allows one winner across independent connections on first-save and update races', async () => {
    const target = new URL(adminUrl!);
    if (target.pathname !== '/portfolio_history_test') throw new Error('Requires portfolio_history_test');
    const schema = `garden_cas_${process.pid}`, role = `${schema}_app`;
    const admin = postgres(target.toString(), { max: 1 });
    const appTarget = new URL(target); appTarget.username = role; appTarget.password = 'synthetic-test-only';
    const options = { max: 1, connection: { search_path: schema } };
    const a = postgres(appTarget.toString(), options), b = postgres(appTarget.toString(), options);
    try {
      // Isolated synthetic schema/role: never drop or modify the existing integration fixtures.
      await admin.unsafe(`CREATE SCHEMA ${schema}; CREATE ROLE ${role} LOGIN PASSWORD 'synthetic-test-only' NOSUPERUSER NOBYPASSRLS;
        GRANT USAGE ON SCHEMA ${schema} TO ${role}; SET search_path = ${schema};
        CREATE TABLE "user" (id text PRIMARY KEY); INSERT INTO "user" VALUES ('garden-a'), ('garden-b');`);
      const directory = (await migrationDirectories()).find(name => name.endsWith('_personal_dividend_garden'))!;
      const migration = (await readFile(`drizzle/${directory}/migration.sql`, 'utf8'))
        .replaceAll('public.garden_states', `${schema}.garden_states`).replaceAll('portfolio_app', role);
      for (const statement of migration.split('--> statement-breakpoint')) if (statement.trim()) await admin.unsafe(statement);
      const ra = createGardenRepository(drizzle({ client: a }) as AppDatabase);
      const rb = createGardenRepository(drizzle({ client: b }) as AppDatabase);
      const owner = (await resolveSessionPrincipal('synthetic', { findActiveUserByTokenHash: async () => 'garden-a' }))!;
      const other = (await resolveSessionPrincipal('synthetic-b', { findActiveUserByTokenHash: async () => 'garden-b' }))!;
      for (const revision of [0, 1]) {
        const outcomes = await Promise.allSettled([ra.save(owner, { revision, lots: [] }), rb.save(owner, { revision, lots: [] })]);
        expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
        expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(1);
        await expect(ra.load(owner)).resolves.toEqual({ revision: revision + 1, lots: [] });
      }
      await expect(rb.load(other)).resolves.toEqual({ revision: 0, lots: [] });
      expect(await a`select * from garden_states`).toHaveLength(0);
      await expect(a.begin(async tx => {
        await tx`select set_config('app.current_user_id', 'garden-b', true)`;
        await tx`insert into garden_states (owner_user_id, revision, lots) values ('garden-a', 3, '[]')`;
      })).rejects.toMatchObject({ code: '42501' });
    } finally {
      await a.end(); await b.end();
      await admin.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE; DROP ROLE IF EXISTS ${role};`);
      await admin.end();
    }
  }, 30_000);
});
