import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import { resolveSessionPrincipal } from '@/auth/session';
import type { AppDatabase } from '@/db/client';
import { createImportRepository } from '@/import/repository';
import { createMemoryPrivateSourceStorage } from '@/import/storage/memory-private-source-storage';
import { applyAllMigrations } from './helpers/migrations';

const HEADER = '約定日,銘柄,銘柄コード,市場,取引,期限,預り,課税,約定数量,約定単価,手数料/諸経費等,税額,受渡日,受渡金額/決済損益';
const READY_ROW = '2026/07/01,合成銘柄,0000,東証,株式現物買,--,特定,申告,10,1000,--,--,2026/07/03,10000';
const REVIEW_ROW = '2026/07/02,合成信用銘柄,0001,東証,信用新規買,6か月,特定,申告,1,500,--,--,2026/07/04,500';
const REJECTED_ROW = '2026/07/03,合成欠損銘柄,0002,東証,,--,特定,申告,1,100,--,--,2026/07/05,100';
const bytes = new TextEncoder().encode(`${HEADER}
${READY_ROW}
${READY_ROW}
${REVIEW_ROW}
${REJECTED_ROW}`);

describe('import repository', () => {
  it('stages one source atomically and reuses it on identical upload', async () => {
    const client = new PGlite();
    try {
      await applyAllMigrations(client);
      await client.exec(`
        insert into "user" (id, name) values ('user-a', 'User A');
        insert into broker_accounts (id, owner_user_id, broker, display_name)
        values
          ('00000000-0000-4000-8000-000000000001', 'user-a', 'sbi', 'SBI'),
          ('00000000-0000-4000-8000-000000000002', 'user-a', 'other', 'Other');
      `);
      const principal = await resolveSessionPrincipal('test-session', {
        findActiveUserByTokenHash: async () => 'user-a',
      });
      expect(principal).not.toBeNull();
      const storage = createMemoryPrivateSourceStorage();
      const repository = createImportRepository(
        drizzle({ client }) as unknown as AppDatabase,
        storage,
      );
      const input = {
        principal: principal!,
        brokerAccountId: '00000000-0000-4000-8000-000000000001',
        mediaType: 'text/csv',
        bytes,
      };

      const first = await repository.stageSbiTradeHistory(input);
      expect(first).toMatchObject({
        disposition: 'new',
        counts: { new: 1, duplicate: 1, needsReview: 1, rejected: 1 },
      });
      await expect(repository.getBatchTrace({
        principal: principal!,
        batchId: first.batchId,
      })).resolves.toMatchObject({
        batchId: first.batchId,
        rows: [
          {
            sourceRow: 2,
            locator: 'csv:row:2',
            status: 'new',
            eventKind: 'cash-trade',
            payload: { instrument: { securityName: '合成銘柄' } },
          },
          {
            sourceRow: 3,
            locator: 'csv:row:3',
            status: 'duplicate',
            eventKind: 'cash-trade',
          },
          {
            sourceRow: 4,
            locator: 'csv:row:4',
            status: 'needs_review',
          },
          {
            sourceRow: 5,
            locator: 'csv:row:5',
            status: 'rejected',
            reasonCode: 'missing-transaction-type',
          },
        ],
      });
      const otherPrincipal = await resolveSessionPrincipal('other-session', {
        findActiveUserByTokenHash: async () => 'user-b',
      });
      await expect(repository.getBatchTrace({
        principal: otherPrincipal!,
        batchId: first.batchId,
      })).resolves.toBeNull();

      const equivalentReadyRow = '2026/07/01,合成銘柄,0000,東証,株式現物買,--,特定,申告,010.00,01000.0,--,--,2026/07/03,010000.00';
      const overlapping = await repository.stageSbiTradeHistory({
        ...input,
        bytes: new TextEncoder().encode(`synthetic metadata\r\n${HEADER}\r\n${equivalentReadyRow}\r\n${REVIEW_ROW}\r\n${REJECTED_ROW}`),
      });
      expect(overlapping).toMatchObject({
        disposition: 'new',
        counts: { new: 1, duplicate: 0, needsReview: 1, rejected: 1 },
      });

      await expect(repository.commitBatch({
        principal: principal!,
        batchId: first.batchId,
      })).resolves.toEqual({ batchId: first.batchId, status: 'committed', committed: 1 });
      await expect(repository.commitBatch({
        principal: principal!,
        batchId: first.batchId,
      })).resolves.toEqual({ batchId: first.batchId, status: 'committed', committed: 1 });
      await expect(repository.commitBatch({
        principal: principal!,
        batchId: overlapping.batchId,
      })).resolves.toEqual({ batchId: overlapping.batchId, status: 'committed', committed: 0 });
      await expect(repository.getBatchTrace({
        principal: principal!,
        batchId: overlapping.batchId,
      })).resolves.toMatchObject({
        rows: [{ sourceRow: 3, status: 'duplicate' }, { sourceRow: 4, status: 'needs_review' }, { sourceRow: 5, status: 'rejected', reasonCode: 'missing-transaction-type' }],
      });

      const second = await repository.stageSbiTradeHistory(input);
      expect(second).toEqual({
        batchId: first.batchId,
        disposition: 'duplicate',
        counts: { new: 0, duplicate: 2, needsReview: 1, rejected: 1 },
      });

      expect(storage.putCallsForTest()).toBe(2);
      for (const brokerAccountId of [
        '00000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000099',
      ]) {
        await expect(repository.stageSbiTradeHistory({
          ...input,
          brokerAccountId,
        })).rejects.toThrow('Broker account is unavailable');
      }
      expect(storage.putCallsForTest()).toBe(2);

      const counts = await client.query<{ sources: number; batches: number; records: number; events: number; ledger: number }>(`
        select
          (select count(*)::int from source_documents) as sources,
          (select count(*)::int from import_batches) as batches,
          (select count(*)::int from source_records) as records,
          (select count(*)::int from staged_events) as events,
          (select count(*)::int from ledger_events) as ledger
      `);
      expect(counts.rows[0]).toEqual({ sources: 2, batches: 2, records: 7, events: 7, ledger: 1 });
      const stored = await client.query<{ storage_key: string }>('select storage_key from source_documents');
      expect(Array.from(storage.readForTest(stored.rows[0].storage_key)!)).toEqual(Array.from(bytes));
    } finally {
      await client.close();
    }
  });

  it('durably records a failed Blob cleanup and reconciles it later', async () => {
    const client = new PGlite();
    try {
      await applyAllMigrations(client);
      await client.exec(`
        insert into "user" (id, name) values ('user-a', 'User A');
        insert into broker_accounts (id, owner_user_id, broker, display_name)
        values ('00000000-0000-4000-8000-000000000001', 'user-a', 'sbi', 'SBI');
      `);
      const principal = await resolveSessionPrincipal('test-session', {
        findActiveUserByTokenHash: async () => 'user-a',
      });
      const memory = createMemoryPrivateSourceStorage();
      let failDelete = true;
      const storage = {
        async put(input: Parameters<typeof memory.put>[0]) {
          const stored = await memory.put(input);
          return { storageKey: `${stored.storageKey}-unexpected` };
        },
        async delete(storageKey: string) {
          if (failDelete) throw new Error('synthetic-delete-failure');
          await memory.delete(storageKey);
        },
      };
      const repository = createImportRepository(
        drizzle({ client }) as unknown as AppDatabase,
        storage,
      );

      await expect(repository.stageSbiTradeHistory({
        principal: principal!,
        brokerAccountId: '00000000-0000-4000-8000-000000000001',
        mediaType: 'text/csv',
        bytes,
      })).rejects.toThrow('Private source storage key mismatch');

      const pending = await client.query<{
        status: string;
        cleanup_attempts: number;
        storage_key: string;
      }>('select status, cleanup_attempts, storage_key from private_source_objects');
      expect(pending.rows).toEqual([expect.objectContaining({
        status: 'cleanup_pending',
        cleanup_attempts: 1,
      })]);
      expect(memory.readForTest(pending.rows[0].storage_key)).not.toBeNull();

      failDelete = false;
      await expect(repository.reconcilePrivateSourceStorage({ principal: principal! }))
        .resolves.toEqual({ inspected: 1, cleaned: 1 });
      expect(memory.readForTest(pending.rows[0].storage_key)).toBeNull();
      await expect(client.query('select * from private_source_objects'))
        .resolves.toMatchObject({ rows: [] });
    } finally {
      await client.close();
    }
  });


  it('never reclaims an old pending upload by age alone', async () => {
    const client = new PGlite();
    try {
      await applyAllMigrations(client);
      await client.exec(`
        insert into "user" (id, name) values ('user-a', 'User A');
        insert into broker_accounts (id, owner_user_id, broker, display_name)
        values ('00000000-0000-4000-8000-000000000001', 'user-a', 'sbi', 'SBI');
      `);
      const principal = await resolveSessionPrincipal('test-session', {
        findActiveUserByTokenHash: async () => 'user-a',
      });
      const storage = createMemoryPrivateSourceStorage();
      const documentId = '30000000-0000-4000-8000-000000000003';
      const stored = await storage.put({
        ownerUserId: 'user-a',
        sourceDocumentId: documentId,
        bytes: new Uint8Array([1]),
      });
      await client.query(`
        insert into private_source_objects
          (id, owner_user_id, broker_account_id, storage_key, status, created_at, updated_at)
        values
          ('${documentId}', 'user-a', '00000000-0000-4000-8000-000000000001',
           '${stored.storageKey}', 'pending_upload', current_timestamp - interval '2 hours', current_timestamp - interval '2 hours')
      `);
      const repository = createImportRepository(
        drizzle({ client }) as unknown as AppDatabase,
        storage,
      );

      await expect(repository.reconcilePrivateSourceStorage({ principal: principal! }))
        .resolves.toEqual({ inspected: 0, cleaned: 0 });
      expect(storage.readForTest(stored.storageKey)).not.toBeNull();
      await expect(client.query<{ status: string }>('select status from private_source_objects'))
        .resolves.toMatchObject({ rows: [{ status: 'pending_upload' }] });
    } finally {
      await client.close();
    }
  });


  it('rolls back source finalization when the upload inventory is no longer pending', async () => {
    const client = new PGlite();
    try {
      await applyAllMigrations(client);
      await client.exec(`
        insert into "user" (id, name) values ('user-a', 'User A');
        insert into broker_accounts (id, owner_user_id, broker, display_name)
        values ('00000000-0000-4000-8000-000000000001', 'user-a', 'sbi', 'SBI');
      `);
      const principal = await resolveSessionPrincipal('test-session', {
        findActiveUserByTokenHash: async () => 'user-a',
      });
      const memory = createMemoryPrivateSourceStorage();
      const storage = {
        async put(input: Parameters<typeof memory.put>[0]) {
          const stored = await memory.put(input);
          await client.query(`update private_source_objects set status = 'cleanup_pending' where storage_key = '${stored.storageKey}'`);
          return stored;
        },
        delete: memory.delete,
      };
      const repository = createImportRepository(
        drizzle({ client }) as unknown as AppDatabase,
        storage,
      );

      await expect(repository.stageSbiTradeHistory({
        principal: principal!,
        brokerAccountId: '00000000-0000-4000-8000-000000000001',
        mediaType: 'text/csv',
        bytes,
      })).rejects.toThrow('upload is no longer active');
      await expect(client.query('select * from source_documents')).resolves.toMatchObject({ rows: [] });
      await expect(client.query('select * from private_source_objects')).resolves.toMatchObject({ rows: [] });
    } finally {
      await client.close();
    }
  });


  it('acquires ledger fingerprint conflicts in one global order', async () => {
    const client = new PGlite();
    try {
      await applyAllMigrations(client);
      await client.exec(`
        insert into "user" (id, name) values ('user-a', 'User A');
        insert into broker_accounts (id, owner_user_id, broker, display_name)
        values ('00000000-0000-4000-8000-000000000001', 'user-a', 'sbi', 'SBI');
        create table ledger_insert_audit (
          sequence bigint generated always as identity primary key,
          fingerprint text not null
        );
        create function audit_ledger_insert() returns trigger language plpgsql as $$
        begin
          insert into ledger_insert_audit (fingerprint) values (new.fingerprint);
          return new;
        end $$;
        create trigger audit_ledger_insert before insert on ledger_events
          for each row execute function audit_ledger_insert();
      `);
      const principal = await resolveSessionPrincipal('test-session', {
        findActiveUserByTokenHash: async () => 'user-a',
      });
      const repository = createImportRepository(
        drizzle({ client }) as unknown as AppDatabase,
        createMemoryPrivateSourceStorage(),
      );
      const rowA = READY_ROW;
      const rowB = '2026/07/02,別の合成銘柄,1111,東証,株式現物買,--,特定,申告,20,500,--,--,2026/07/04,10000';
      const first = await repository.stageSbiTradeHistory({
        principal: principal!,
        brokerAccountId: '00000000-0000-4000-8000-000000000001',
        mediaType: 'text/csv',
        bytes: new TextEncoder().encode(`${HEADER}\n${rowA}\n${rowB}`),
      });
      const observed = await client.query<{ fingerprint: string; source_row: number }>(`
        select se.fingerprint, sr.source_row
        from staged_events se join source_records sr on sr.id = se.source_record_id
        where se.batch_id = '${first.batchId}' order by sr.source_row
      `);
      const rowBySource = new Map([[2, rowA], [3, rowB]]);
      const descendingRows = observed.rows
        .slice()
        .sort((left, right) => right.fingerprint.localeCompare(left.fingerprint))
        .map((event) => rowBySource.get(event.source_row)!);
      const second = await repository.stageSbiTradeHistory({
        principal: principal!,
        brokerAccountId: '00000000-0000-4000-8000-000000000001',
        mediaType: 'text/csv',
        bytes: new TextEncoder().encode(`synthetic metadata\n${HEADER}\n${descendingRows.join('\n')}`),
      });

      await repository.commitBatch({ principal: principal!, batchId: second.batchId });
      const audit = await client.query<{ fingerprint: string }>(
        'select fingerprint from ledger_insert_audit order by sequence',
      );
      expect(audit.rows.map((entry) => entry.fingerprint)).toEqual(
        audit.rows.map((entry) => entry.fingerprint).slice().sort(),
      );
    } finally {
      await client.close();
    }
  });

});
