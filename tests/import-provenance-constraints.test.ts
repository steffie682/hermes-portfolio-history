import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { applyAllMigrations } from './helpers/migrations';

const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const OBJECT_A = '10000000-0000-4000-8000-000000000001';
const OBJECT_B = '10000000-0000-4000-8000-000000000002';
const OBJECT_C = '10000000-0000-4000-8000-000000000003';
const OBJECT_D = '10000000-0000-4000-8000-000000000004';
const BATCH_A = '20000000-0000-4000-8000-000000000001';
const BATCH_B = '20000000-0000-4000-8000-000000000002';
const RECORD_A = '30000000-0000-4000-8000-000000000001';
const RECORD_B = '30000000-0000-4000-8000-000000000002';
const EVENT_A = '40000000-0000-4000-8000-000000000001';
const EVENT_B = '40000000-0000-4000-8000-000000000002';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

async function expectForeignKeyFailure(db: PGlite, statement: string) {
  await expect(db.exec(statement)).rejects.toMatchObject({ code: '23503' });
}

describe('import provenance constraints', () => {
  it('rejects same-owner account, source, batch, record, and event mixing', async () => {
    const db = new PGlite();
    try {
      await applyAllMigrations(db);
      await db.exec(`
        insert into "user" (id, name) values ('user-a', 'User A');
        insert into broker_accounts (id, owner_user_id, broker, display_name) values
          ('${A}', 'user-a', 'sbi', 'A'), ('${B}', 'user-a', 'sbi', 'B');
        insert into private_source_objects
          (id, owner_user_id, broker_account_id, storage_key, status) values
          ('${OBJECT_A}', 'user-a', '${A}', 'sources/a/a.csv', 'retained'),
          ('${OBJECT_B}', 'user-a', '${B}', 'sources/b/b.csv', 'retained'),
          ('${OBJECT_C}', 'user-a', '${B}', 'sources/b/c.csv', 'retained'),
          ('${OBJECT_D}', 'user-a', '${B}', 'sources/b/d.csv', 'retained');
        insert into source_documents
          (id, owner_user_id, broker_account_id, content_sha256, media_type, byte_size, storage_key, document_type, status) values
          ('${OBJECT_A}', 'user-a', '${A}', '${HASH_A}', 'text/csv', 1, 'sources/a/a.csv', 'sbi_trade_history_csv', 'stored'),
          ('${OBJECT_B}', 'user-a', '${B}', '${HASH_B}', 'text/csv', 1, 'sources/b/b.csv', 'sbi_trade_history_csv', 'stored'),
          ('${OBJECT_D}', 'user-a', '${B}', '${'d'.repeat(64)}', 'text/csv', 1, 'sources/b/d.csv', 'sbi_trade_history_csv', 'stored');
        insert into import_batches
          (id, owner_user_id, broker_account_id, source_document_id, parser_name, parser_version, status) values
          ('${BATCH_A}', 'user-a', '${A}', '${OBJECT_A}', 'sbi', '1', 'preview_ready'),
          ('${BATCH_B}', 'user-a', '${B}', '${OBJECT_B}', 'sbi', '1', 'preview_ready');
        insert into source_records
          (id, owner_user_id, batch_id, source_document_id, locator, source_row, record_sha256) values
          ('${RECORD_A}', 'user-a', '${BATCH_A}', '${OBJECT_A}', 'csv:row:2', 2, '${HASH_A}'),
          ('${RECORD_B}', 'user-a', '${BATCH_B}', '${OBJECT_B}', 'csv:row:2', 2, '${HASH_B}');
        insert into staged_events
          (id, owner_user_id, broker_account_id, batch_id, source_record_id, status, fingerprint) values
          ('${EVENT_A}', 'user-a', '${A}', '${BATCH_A}', '${RECORD_A}', 'needs_review', '${HASH_A}'),
          ('${EVENT_B}', 'user-a', '${B}', '${BATCH_B}', '${RECORD_B}', 'needs_review', '${HASH_B}');
      `);

      await expectForeignKeyFailure(db, `
        insert into source_documents
          (id, owner_user_id, broker_account_id, content_sha256, media_type, byte_size, storage_key, document_type, status)
        values ('${OBJECT_C}', 'user-a', '${A}', '${'c'.repeat(64)}', 'text/csv', 1, 'sources/b/c.csv', 'sbi_trade_history_csv', 'stored')
      `);
      await expectForeignKeyFailure(db, `
        insert into import_batches
          (owner_user_id, broker_account_id, source_document_id, parser_name, parser_version, status)
        values ('user-a', '${A}', '${OBJECT_D}', 'sbi', '1', 'preview_ready')
      `);
      await expectForeignKeyFailure(db, `
        insert into source_records
          (owner_user_id, batch_id, source_document_id, locator, source_row, record_sha256)
        values ('user-a', '${BATCH_A}', '${OBJECT_B}', 'csv:row:3', 3, '${'c'.repeat(64)}')
      `);
      await expectForeignKeyFailure(db, `
        insert into staged_events
          (owner_user_id, broker_account_id, batch_id, source_record_id, status, fingerprint)
        values ('user-a', '${A}', '${BATCH_A}', '${RECORD_B}', 'needs_review', '${'c'.repeat(64)}')
      `);
      await expectForeignKeyFailure(db, `
        insert into ledger_events
          (owner_user_id, broker_account_id, staged_event_id, fingerprint, event_kind, payload)
        values ('user-a', '${A}', '${EVENT_B}', '${'c'.repeat(64)}', 'cash-trade', '{}')
      `);
    } finally {
      await db.close();
    }
  });

  it('blocks account and user deletion while private Blob inventory remains', async () => {
    const db = new PGlite();
    try {
      await applyAllMigrations(db);
      await db.exec(`
        insert into "user" (id, name) values ('user-a', 'User A');
        insert into broker_accounts (id, owner_user_id, broker, display_name)
        values ('${A}', 'user-a', 'sbi', 'A');
        insert into private_source_objects
          (id, owner_user_id, broker_account_id, storage_key, status)
        values ('${OBJECT_A}', 'user-a', '${A}', 'sources/a/a.csv', 'retained');
      `);
      await expect(db.exec(`delete from broker_accounts where id = '${A}'`))
        .rejects.toMatchObject({ code: '23001' });
      await expect(db.exec(`delete from "user" where id = 'user-a'`))
        .rejects.toMatchObject({ code: '23001' });
    } finally {
      await db.close();
    }
  });
});
