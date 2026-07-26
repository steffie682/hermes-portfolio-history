import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { applyAllMigrations } from './helpers/migrations';

describe('initial migration', () => {
  it('revokes PUBLIC access before granting the runtime role enrollment access', () => {
    const sql = readFileSync(
      'drizzle/20260720004828_rainy_bucky/migration.sql',
      'utf8',
    );
    expect(sql).toContain(
      'REVOKE ALL ON "device_enrollment_grants" FROM PUBLIC;',
    );
  });

  it('forces tenant RLS and grants only the runtime role on import tables', () => {
    const sql = readFileSync(
      'drizzle/20260721141351_dashing_pixie/migration.sql',
      'utf8',
    );
    for (const table of [
      'private_source_objects',
      'source_documents',
      'import_batches',
      'source_records',
      'staged_events',
      'ledger_events',
    ]) {
      expect(sql).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`REVOKE ALL ON "${table}" FROM PUBLIC;`);
    }
    expect(sql).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON "private_source_objects", "source_documents", "import_batches", "source_records", "staged_events", "ledger_events" TO portfolio_app;',
    );
    for (const constraint of [
      'private_source_objects_owner_broker_account_fk',
      'source_documents_owner_broker_account_fk',
      'source_documents_owner_account_storage_object_fk',
      'import_batches_owner_broker_account_fk',
      'import_batches_owner_account_source_document_fk',
      'source_records_owner_batch_source_document_fk',
      'staged_events_owner_account_batch_fk',
      'staged_events_owner_record_batch_fk',
      'ledger_events_owner_broker_account_fk',
      'ledger_events_owner_account_staged_event_fk',
    ]) {
      expect(sql).toContain(`CONSTRAINT "${constraint}" FOREIGN KEY ("owner_user_id",`);
    }
  });

  it('remediates committed ledger access for already-migrated databases', () => {
    const sql = readFileSync(
      'drizzle/20260723122410_cloudy_fat_cobra/migration.sql',
      'utf8',
    );

    expect(sql).toContain(
      'DROP POLICY "ledger_events_owner_isolation" ON "ledger_events";',
    );
    expect(sql).toContain(
      'CREATE POLICY "ledger_events_owner_select" ON "ledger_events" AS PERMISSIVE FOR SELECT TO public USING',
    );
    expect(sql).toContain(
      'CREATE POLICY "ledger_events_owner_insert" ON "ledger_events" AS PERMISSIVE FOR INSERT TO public WITH CHECK',
    );
    expect(sql).not.toMatch(
      /CREATE POLICY "[^"]+" ON "ledger_events" AS PERMISSIVE FOR (?:ALL|UPDATE|DELETE)\b/,
    );
    expect(sql).toContain(
      'ALTER TABLE "ledger_events" FORCE ROW LEVEL SECURITY;',
    );
    expect(sql).toContain(
      'REVOKE UPDATE, DELETE ON "ledger_events" FROM portfolio_app;',
    );
    expect(sql).toContain(
      'GRANT SELECT, INSERT ON "ledger_events" TO portfolio_app;',
    );
  });

  it('adds append-only tenant-isolated balance report evidence', () => {
    const latestDirectory = readdirSync('drizzle', { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .at(-1);
    const sql = readFileSync(`drizzle/${latestDirectory}/migration.sql`, 'utf8');
    for (const table of ['balance_report_snapshots', 'balance_report_positions']) {
      expect(sql).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`REVOKE ALL ON "${table}" FROM PUBLIC;`);
    }
    expect(sql).toContain(
      'REVOKE ALL ON "balance_report_snapshots", "balance_report_positions" FROM portfolio_app;',
    );
    expect(sql).toContain(
      'GRANT SELECT, INSERT ON "balance_report_snapshots", "balance_report_positions" TO portfolio_app;',
    );
    expect(sql).not.toMatch(/GRANT [^;]*(?:UPDATE|DELETE)[^;]*balance_report_/);
    expect(sql).toContain('balance_report_snapshots_owner_broker_account_fk');
    expect(sql).toContain('balance_report_positions_owner_account_snapshot_fk');
    expect(sql).toContain('"source_row" integer NOT NULL');
    expect(sql).toContain('balance_report_positions_snapshot_source_locator_uidx');
    expect(sql).toContain(
      'CONSTRAINT "balance_report_snapshots_position_count_check" CHECK ("position_count" BETWEEN 0 AND 100)',
    );
    expect(sql).not.toMatch(/balance_report_snapshots_purpose_check|["]purpose["]/);
  });

  it('applies the zero-position snapshot constraint from the newest migration', async () => {
    const db = new PGlite();
    try {
      await applyAllMigrations(db);
      await db.exec(`
        insert into "user" (id, name) values ('migration-zero-user', 'Migration Zero');
        insert into broker_accounts (id, owner_user_id, broker, display_name)
        values ('00000000-0000-4000-8000-000000000090', 'migration-zero-user', 'sbi', 'SBI');
        insert into balance_report_snapshots (
          owner_user_id, broker_account_id, statement_date,
          fingerprint, status, position_count
        ) values (
          'migration-zero-user', '00000000-0000-4000-8000-000000000090',
          '2026-07-24', repeat('0', 64), 'confirmed', 0
        );
      `);
      await expect(db.exec(`
        insert into balance_report_snapshots (
          owner_user_id, broker_account_id, statement_date,
          fingerprint, status, position_count
        ) values (
          'migration-zero-user', '00000000-0000-4000-8000-000000000090',
          '2026-07-24', repeat('1', 64), 'confirmed', -1
        );
      `)).rejects.toThrow();
    } finally {
      await db.close();
    }
  });

  it('applies cleanly with the expected app_metadata constraints', async () => {
    const db = new PGlite();
    try {
      await applyAllMigrations(db);

      const columns = await db.query<{
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_default: string | null;
      }>(
        `select column_name, data_type, is_nullable, column_default
         from information_schema.columns
         where table_schema = 'public' and table_name = 'app_metadata'
         order by ordinal_position`,
      );
      expect(columns.rows).toEqual([
        { column_name: 'key', data_type: 'text', is_nullable: 'NO', column_default: null },
        { column_name: 'value', data_type: 'text', is_nullable: 'NO', column_default: null },
        {
          column_name: 'created_at',
          data_type: 'timestamp with time zone',
          is_nullable: 'NO',
          column_default: 'now()',
        },
      ]);

      const primaryKey = await db.query<{ column_name: string }>(
        `select kcu.column_name
         from information_schema.table_constraints tc
         join information_schema.key_column_usage kcu
           on tc.constraint_name = kcu.constraint_name
          and tc.constraint_schema = kcu.constraint_schema
         where tc.table_schema = 'public'
           and tc.table_name = 'app_metadata'
           and tc.constraint_type = 'PRIMARY KEY'`,
      );
      expect(primaryKey.rows).toEqual([{ column_name: 'key' }]);

      const authTables = await db.query<{ table_name: string }>(
        `select table_name from information_schema.tables
         where table_schema = 'public'
           and table_name in (
             'auth_challenges',
             'auth_sessions',
             'device_enrollment_grants',
             'passkey_credentials'
           )
         order by table_name`,
      );
      expect(authTables.rows).toEqual([
        { table_name: 'auth_challenges' },
        { table_name: 'auth_sessions' },
        { table_name: 'device_enrollment_grants' },
        { table_name: 'passkey_credentials' },
      ]);

      const grantColumns = await db.query<{
        column_name: string;
        is_nullable: string;
      }>(
        `select column_name, is_nullable
         from information_schema.columns
         where table_schema = 'public'
           and table_name = 'device_enrollment_grants'
         order by ordinal_position`,
      );
      expect(grantColumns.rows).toEqual([
        { column_name: 'token_hash', is_nullable: 'NO' },
        { column_name: 'user_id', is_nullable: 'NO' },
        { column_name: 'challenge', is_nullable: 'NO' },
        { column_name: 'expires_at', is_nullable: 'NO' },
        { column_name: 'created_at', is_nullable: 'NO' },
        { column_name: 'source_session_id', is_nullable: 'NO' },
        { column_name: 'purpose', is_nullable: 'NO' },
      ]);

      const sessionColumns = await db.query<{
        column_name: string;
        is_nullable: string;
      }>(
        `select column_name, is_nullable
         from information_schema.columns
         where table_schema = 'public'
           and table_name = 'auth_sessions'
           and column_name in ('auth_method', 'authenticated_at')
         order by column_name`,
      );
      expect(sessionColumns.rows).toEqual([
        { column_name: 'auth_method', is_nullable: 'YES' },
        { column_name: 'authenticated_at', is_nullable: 'YES' },
      ]);
    } finally {
      await db.close();
    }
  });
});
