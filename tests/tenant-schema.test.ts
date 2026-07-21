import { getTableColumns, getTableName } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  authUsers,
  brokerAccounts,
  importBatches,
  ledgerEvents,
  privateSourceObjects,
  sourceDocuments,
  sourceRecords,
  stagedEvents,
} from '@/db/schema';

describe('tenant-owned schema', () => {
  it('links every broker account to an authentication user', () => {
    expect(getTableName(authUsers)).toBe('user');
    expect(getTableName(brokerAccounts)).toBe('broker_accounts');
    expect(getTableColumns(brokerAccounts).ownerUserId.name).toBe('owner_user_id');
    expect(getTableColumns(brokerAccounts).ownerUserId.notNull).toBe(true);
  });

  it('defines owner-isolated import tracking and ledger tables', () => {
    const expected = [
      [privateSourceObjects, 'private_source_objects', 'private_source_objects_owner_isolation'],
      [sourceDocuments, 'source_documents', 'source_documents_owner_isolation'],
      [importBatches, 'import_batches', 'import_batches_owner_isolation'],
      [sourceRecords, 'source_records', 'source_records_owner_isolation'],
      [stagedEvents, 'staged_events', 'staged_events_owner_isolation'],
      [ledgerEvents, 'ledger_events', 'ledger_events_owner_isolation'],
    ] as const;

    for (const [table, name, policy] of expected) {
      expect(getTableName(table)).toBe(name);
      expect(getTableColumns(table).ownerUserId.notNull).toBe(true);
      const config = getTableConfig(table);
      expect(config.enableRLS).toBe(true);
      expect(config.policies.map((candidate) => candidate.name)).toContain(policy);
    }
  });

  it('binds the complete provenance chain to one account, document, and batch', () => {
    expect(getTableColumns(stagedEvents).brokerAccountId.notNull).toBe(true);
    const expectedForeignKeys = [
      [sourceDocuments, 'source_documents_owner_account_storage_object_fk'],
      [importBatches, 'import_batches_owner_account_source_document_fk'],
      [sourceRecords, 'source_records_owner_batch_source_document_fk'],
      [stagedEvents, 'staged_events_owner_account_batch_fk'],
      [stagedEvents, 'staged_events_owner_record_batch_fk'],
      [ledgerEvents, 'ledger_events_owner_account_staged_event_fk'],
    ] as const;
    for (const [table, foreignKeyName] of expectedForeignKeys) {
      expect(getTableConfig(table).foreignKeys.map((foreignKey) => foreignKey.getName()))
        .toContain(foreignKeyName);
    }
  });

  it('enforces event fingerprint uniqueness only in the committed ledger', () => {
    const stagedIndexes = getTableConfig(stagedEvents).indexes;
    expect(stagedIndexes.some((index) => index.config.name === 'staged_events_owner_fingerprint_uidx')).toBe(false);
    const ledgerIndex = getTableConfig(ledgerEvents).indexes.find(
      (index) => index.config.name === 'ledger_events_owner_fingerprint_uidx',
    );
    expect(ledgerIndex?.config.unique).toBe(true);
    expect(getTableColumns(ledgerEvents).fingerprint.notNull).toBe(true);
  });

  it('enables row-level security with an owner policy', () => {
    const config = getTableConfig(brokerAccounts);
    expect(config.enableRLS).toBe(true);
    expect(config.policies.map((policy) => policy.name)).toEqual([
      'broker_accounts_owner_isolation',
    ]);
  });
});
