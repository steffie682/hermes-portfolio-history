import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  bytea,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  date,
} from 'drizzle-orm/pg-core';

export const appMetadata = pgTable('app_metadata', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const authUsers = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  deletionRequestedAt: timestamp('deletion_requested_at', { withTimezone: true }),
});

export const brokerAccounts = pgTable.withRLS(
  'broker_accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    broker: text('broker').notNull(),
    displayName: text('display_name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('broker_accounts_owner_id_uidx').on(table.ownerUserId, table.id),
    pgPolicy('broker_accounts_owner_isolation', {
      for: 'all',
      to: 'public',
      using: sql`${table.ownerUserId} = nullif(current_setting('app.current_user_id', true), '')`,
      withCheck: sql`${table.ownerUserId} = nullif(current_setting('app.current_user_id', true), '')`,
    }),
  ],
);

export const privateSourceObjects = pgTable.withRLS(
  'private_source_objects',
  {
    id: uuid('id').primaryKey(),
    ownerUserId: text('owner_user_id').notNull().references(() => authUsers.id, { onDelete: 'restrict' }),
    brokerAccountId: uuid('broker_account_id').notNull(),
    storageKey: text('storage_key').notNull().unique(),
    status: text('status').notNull(),
    cleanupAttempts: integer('cleanup_attempts').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('private_source_objects_owner_id_uidx').on(table.ownerUserId, table.id),
    uniqueIndex('private_source_objects_owner_id_key_uidx').on(table.ownerUserId, table.id, table.storageKey),
    uniqueIndex('private_source_objects_owner_account_id_key_uidx').on(
      table.ownerUserId, table.brokerAccountId, table.id, table.storageKey,
    ),
    foreignKey({
      name: 'private_source_objects_owner_broker_account_fk',
      columns: [table.ownerUserId, table.brokerAccountId],
      foreignColumns: [brokerAccounts.ownerUserId, brokerAccounts.id],
    }).onDelete('restrict'),
    check('private_source_objects_status_check', sql`${table.status} IN ('pending_upload', 'retained', 'cleanup_pending')`),
    check('private_source_objects_cleanup_attempts_check', sql`${table.cleanupAttempts} >= 0`),
    pgPolicy('private_source_objects_owner_isolation', {
      for: 'all', to: 'public',
      using: sql`${table.ownerUserId} = nullif(current_setting('app.current_user_id', true), '')`,
      withCheck: sql`${table.ownerUserId} = nullif(current_setting('app.current_user_id', true), '')`,
    }),
  ],
);

export const sourceDocuments = pgTable.withRLS(
  'source_documents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerUserId: text('owner_user_id').notNull().references(() => authUsers.id, { onDelete: 'cascade' }),
    brokerAccountId: uuid('broker_account_id').notNull(),
    contentSha256: text('content_sha256').notNull(),
    mediaType: text('media_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    storageKey: text('storage_key').notNull(),
    documentType: text('document_type').notNull(),
    status: text('status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('source_documents_owner_id_uidx').on(table.ownerUserId, table.id),
    uniqueIndex('source_documents_owner_account_id_uidx').on(
      table.ownerUserId, table.brokerAccountId, table.id,
    ),
    foreignKey({
      name: 'source_documents_owner_broker_account_fk',
      columns: [table.ownerUserId, table.brokerAccountId],
      foreignColumns: [brokerAccounts.ownerUserId, brokerAccounts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'source_documents_owner_account_storage_object_fk',
      columns: [table.ownerUserId, table.brokerAccountId, table.id, table.storageKey],
      foreignColumns: [
        privateSourceObjects.ownerUserId,
        privateSourceObjects.brokerAccountId,
        privateSourceObjects.id,
        privateSourceObjects.storageKey,
      ],
    }).onDelete('restrict'),
    uniqueIndex('source_documents_owner_account_sha256_uidx').on(
      table.ownerUserId,
      table.brokerAccountId,
      table.contentSha256,
    ),
    check('source_documents_sha256_check', sql`char_length(${table.contentSha256}) = 64 AND ${table.contentSha256} ~ '^[0-9a-f]{64}$'`),
    check('source_documents_byte_size_check', sql`${table.byteSize} BETWEEN 1 AND 10485760`),
    check('source_documents_type_check', sql`${table.documentType} = 'sbi_trade_history_csv'`),
    check('source_documents_status_check', sql`${table.status} IN ('stored', 'rejected')`),
    pgPolicy('source_documents_owner_isolation', {
      for: 'all',
      to: 'public',
      using: sql`${table.ownerUserId} = nullif(current_setting('app.current_user_id', true), '')`,
      withCheck: sql`${table.ownerUserId} = nullif(current_setting('app.current_user_id', true), '')`,
    }),
  ],
);

export const importBatches = pgTable.withRLS(
  'import_batches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerUserId: text('owner_user_id').notNull().references(() => authUsers.id, { onDelete: 'cascade' }),
    brokerAccountId: uuid('broker_account_id').notNull(),
    sourceDocumentId: uuid('source_document_id').notNull(),
    parserName: text('parser_name').notNull(),
    parserVersion: text('parser_version').notNull(),
    status: text('status').notNull(),
    committedAt: timestamp('committed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('import_batches_owner_id_uidx').on(table.ownerUserId, table.id),
    uniqueIndex('import_batches_owner_account_id_uidx').on(table.ownerUserId, table.brokerAccountId, table.id),
    uniqueIndex('import_batches_owner_id_source_uidx').on(table.ownerUserId, table.id, table.sourceDocumentId),
    uniqueIndex('import_batches_owner_source_uidx').on(table.ownerUserId, table.sourceDocumentId),
    foreignKey({
      name: 'import_batches_owner_broker_account_fk',
      columns: [table.ownerUserId, table.brokerAccountId],
      foreignColumns: [brokerAccounts.ownerUserId, brokerAccounts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'import_batches_owner_account_source_document_fk',
      columns: [table.ownerUserId, table.brokerAccountId, table.sourceDocumentId],
      foreignColumns: [sourceDocuments.ownerUserId, sourceDocuments.brokerAccountId, sourceDocuments.id],
    }).onDelete('cascade'),
    check('import_batches_status_check', sql`${table.status} IN ('preview_ready', 'committed', 'rejected')`),
    pgPolicy('import_batches_owner_isolation', {
      for: 'all', to: 'public',
      using: sql`${table.ownerUserId} = nullif(current_setting('app.current_user_id', true), '')`,
      withCheck: sql`${table.ownerUserId} = nullif(current_setting('app.current_user_id', true), '')`,
    }),
  ],
);

export const sourceRecords = pgTable.withRLS(
  'source_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerUserId: text('owner_user_id').notNull().references(() => authUsers.id, { onDelete: 'cascade' }),
    batchId: uuid('batch_id').notNull(),
    sourceDocumentId: uuid('source_document_id').notNull(),
    locator: text('locator').notNull(),
    sourcePage: integer('source_page'),
    sourceRow: integer('source_row').notNull(),
    recordSha256: text('record_sha256').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('source_records_owner_id_uidx').on(table.ownerUserId, table.id),
    uniqueIndex('source_records_owner_id_batch_uidx').on(table.ownerUserId, table.id, table.batchId),
    uniqueIndex('source_records_document_locator_uidx').on(table.sourceDocumentId, table.locator),
    foreignKey({
      name: 'source_records_owner_batch_source_document_fk',
      columns: [table.ownerUserId, table.batchId, table.sourceDocumentId],
      foreignColumns: [importBatches.ownerUserId, importBatches.id, importBatches.sourceDocumentId],
    }).onDelete('cascade'),
    check('source_records_row_check', sql`${table.sourceRow} > 0`),
    check('source_records_sha256_check', sql`char_length(${table.recordSha256}) = 64 AND ${table.recordSha256} ~ '^[0-9a-f]{64}$'`),
    pgPolicy('source_records_owner_isolation', {
      for: 'all', to: 'public',
      using: sql`${table.ownerUserId} = nullif(current_setting('app.current_user_id', true), '')`,
      withCheck: sql`${table.ownerUserId} = nullif(current_setting('app.current_user_id', true), '')`,
    }),
  ],
);

export const stagedEvents = pgTable.withRLS(
  'staged_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerUserId: text('owner_user_id').notNull().references(() => authUsers.id, { onDelete: 'cascade' }),
    brokerAccountId: uuid('broker_account_id').notNull(),
    batchId: uuid('batch_id').notNull(),
    sourceRecordId: uuid('source_record_id').notNull(),
    status: text('status').notNull(),
    reasonCode: text('reason_code'),
    eventKind: text('event_kind'),
    fingerprint: text('fingerprint').notNull(),
    payload: jsonb('payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('staged_events_owner_id_uidx').on(table.ownerUserId, table.id),
    uniqueIndex('staged_events_owner_account_id_uidx').on(table.ownerUserId, table.brokerAccountId, table.id),
    uniqueIndex('staged_events_batch_source_uidx').on(table.batchId, table.sourceRecordId),
    foreignKey({
      name: 'staged_events_owner_account_batch_fk',
      columns: [table.ownerUserId, table.brokerAccountId, table.batchId],
      foreignColumns: [importBatches.ownerUserId, importBatches.brokerAccountId, importBatches.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'staged_events_owner_record_batch_fk',
      columns: [table.ownerUserId, table.sourceRecordId, table.batchId],
      foreignColumns: [sourceRecords.ownerUserId, sourceRecords.id, sourceRecords.batchId],
    }).onDelete('cascade'),
    check('staged_events_status_check', sql`${table.status} IN ('new', 'needs_review', 'duplicate', 'rejected')`),
    check('staged_events_fingerprint_check', sql`char_length(${table.fingerprint}) = 64 AND ${table.fingerprint} ~ '^[0-9a-f]{64}$'`),
    pgPolicy('staged_events_owner_isolation', {
      for: 'all', to: 'public',
      using: sql`${table.ownerUserId} = nullif(current_setting('app.current_user_id', true), '')`,
      withCheck: sql`${table.ownerUserId} = nullif(current_setting('app.current_user_id', true), '')`,
    }),
  ],
);

export const ledgerEvents = pgTable.withRLS(
  'ledger_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerUserId: text('owner_user_id').notNull().references(() => authUsers.id, { onDelete: 'cascade' }),
    brokerAccountId: uuid('broker_account_id').notNull(),
    stagedEventId: uuid('staged_event_id').notNull().unique(),
    fingerprint: text('fingerprint').notNull(),
    eventKind: text('event_kind').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('ledger_events_owner_fingerprint_uidx').on(table.ownerUserId, table.fingerprint),
    foreignKey({
      name: 'ledger_events_owner_broker_account_fk',
      columns: [table.ownerUserId, table.brokerAccountId],
      foreignColumns: [brokerAccounts.ownerUserId, brokerAccounts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'ledger_events_owner_account_staged_event_fk',
      columns: [table.ownerUserId, table.brokerAccountId, table.stagedEventId],
      foreignColumns: [stagedEvents.ownerUserId, stagedEvents.brokerAccountId, stagedEvents.id],
    }).onDelete('restrict'),
    check('ledger_events_fingerprint_check', sql`char_length(${table.fingerprint}) = 64 AND ${table.fingerprint} ~ '^[0-9a-f]{64}$'`),
    pgPolicy('ledger_events_owner_select', {
      for: 'select', to: 'public',
      using: sql`${table.ownerUserId} = nullif(current_setting('app.current_user_id', true), '')`,
    }),
    pgPolicy('ledger_events_owner_insert', {
      for: 'insert', to: 'public',
      withCheck: sql`${table.ownerUserId} = nullif(current_setting('app.current_user_id', true), '')`,
    }),
  ],
);

export const balanceReportSnapshots = pgTable.withRLS(
  'balance_report_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerUserId: text('owner_user_id').notNull().references(() => authUsers.id, { onDelete: 'restrict' }),
    brokerAccountId: uuid('broker_account_id').notNull(),
    statementDate: date('statement_date', { mode: 'string' }).notNull(),
    fingerprint: text('fingerprint').notNull(),
    status: text('status').notNull(),
    positionCount: integer('position_count').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('balance_report_snapshots_owner_account_id_uidx')
      .on(table.ownerUserId, table.brokerAccountId, table.id),
    uniqueIndex('balance_report_snapshots_owner_fingerprint_uidx')
      .on(table.ownerUserId, table.fingerprint),
    foreignKey({
      name: 'balance_report_snapshots_owner_broker_account_fk',
      columns: [table.ownerUserId, table.brokerAccountId],
      foreignColumns: [brokerAccounts.ownerUserId, brokerAccounts.id],
    }).onDelete('restrict'),
    check('balance_report_snapshots_status_check', sql`${table.status} = 'confirmed'`),
    check('balance_report_snapshots_position_count_check', sql`${table.positionCount} BETWEEN 0 AND 100`),
    check('balance_report_snapshots_fingerprint_check', sql`${table.fingerprint} ~ '^[0-9a-f]{64}$'`),
    pgPolicy('balance_report_snapshots_owner_select', {
      for: 'select', to: 'public',
      using: sql`${table.ownerUserId} = nullif(current_setting('app.current_user_id', true), '')`,
    }),
    pgPolicy('balance_report_snapshots_owner_insert', {
      for: 'insert', to: 'public',
      withCheck: sql`${table.ownerUserId} = nullif(current_setting('app.current_user_id', true), '')`,
    }),
  ],
);

export const balanceReportPositions = pgTable.withRLS(
  'balance_report_positions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerUserId: text('owner_user_id').notNull().references(() => authUsers.id, { onDelete: 'restrict' }),
    brokerAccountId: uuid('broker_account_id').notNull(),
    snapshotId: uuid('snapshot_id').notNull(),
    positionIndex: integer('position_index').notNull(),
    sourcePage: integer('source_page').notNull(),
    sourceRow: integer('source_row').notNull(),
    side: text('side').notNull(),
    securityCode: text('security_code').notNull(),
    securityName: text('security_name').notNull(),
    quantity: text('quantity').notNull(),
    unitPriceYen: numeric('unit_price_yen', { precision: 24, scale: 6, mode: 'string' }).notNull(),
    openedOn: date('opened_on', { mode: 'string' }).notNull(),
    dueOn: date('due_on', { mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('balance_report_positions_snapshot_index_uidx')
      .on(table.snapshotId, table.positionIndex),
    uniqueIndex('balance_report_positions_snapshot_source_locator_uidx')
      .on(table.snapshotId, table.sourcePage, table.sourceRow),
    foreignKey({
      name: 'balance_report_positions_owner_account_snapshot_fk',
      columns: [table.ownerUserId, table.brokerAccountId, table.snapshotId],
      foreignColumns: [
        balanceReportSnapshots.ownerUserId,
        balanceReportSnapshots.brokerAccountId,
        balanceReportSnapshots.id,
      ],
    }).onDelete('restrict'),
    check('balance_report_positions_index_check', sql`${table.positionIndex} BETWEEN 1 AND 100`),
    check('balance_report_positions_source_page_check', sql`${table.sourcePage} BETWEEN 1 AND 100`),
    check('balance_report_positions_source_row_check', sql`${table.sourceRow} BETWEEN 1 AND 100`),
    check('balance_report_positions_side_check', sql`${table.side} IN ('buy', 'sell')`),
    check('balance_report_positions_security_code_check', sql`${table.securityCode} ~ '^[A-Z0-9]{4}$'`),
    check('balance_report_positions_security_name_check', sql`char_length(${table.securityName}) BETWEEN 1 AND 100`),
    check('balance_report_positions_quantity_check', sql`${table.quantity} ~ '^[1-9][0-9]{0,17}$'`),
    check('balance_report_positions_price_check', sql`${table.unitPriceYen} > 0`),
    check('balance_report_positions_dates_check', sql`${table.dueOn} IS NULL OR ${table.dueOn} >= ${table.openedOn}`),
    pgPolicy('balance_report_positions_owner_select', {
      for: 'select', to: 'public',
      using: sql`${table.ownerUserId} = nullif(current_setting('app.current_user_id', true), '')`,
    }),
    pgPolicy('balance_report_positions_owner_insert', {
      for: 'insert', to: 'public',
      withCheck: sql`${table.ownerUserId} = nullif(current_setting('app.current_user_id', true), '')`,
    }),
  ],
);

export const fullBalanceReportCheckpoints = pgTable.withRLS(
  'full_balance_report_checkpoints',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerUserId: text('owner_user_id').notNull().references(() => authUsers.id, { onDelete: 'restrict' }),
    brokerAccountId: uuid('broker_account_id').notNull(),
    statementDate: date('statement_date', { mode: 'string' }).notNull(),
    sourcePageCount: integer('source_page_count').notNull(),
    fingerprint: text('fingerprint').notNull(),
    genericAsOf: boolean('generic_as_of').notNull(),
    manuallyConfirmed: boolean('manually_confirmed').notNull(),
    allRelevantPagesReviewed: boolean('all_relevant_pages_reviewed').notNull(),
    fingerprintVersion: integer('fingerprint_version').notNull(),
    depositCount: integer('deposit_count').notNull(),
    collateralCount: integer('collateral_count').notNull(),
    domesticStockLotCount: integer('domestic_stock_lot_count').notNull(),
    fundBalanceCount: integer('fund_balance_count').notNull(),
    marginCount: integer('margin_count').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('full_balance_report_checkpoints_owner_account_id_uidx')
      .on(table.ownerUserId, table.brokerAccountId, table.id),
    uniqueIndex('full_balance_report_checkpoints_owner_fingerprint_uidx')
      .on(table.ownerUserId, table.fingerprint),
    foreignKey({
      name: 'full_balance_report_checkpoints_owner_broker_account_fk',
      columns: [table.ownerUserId, table.brokerAccountId],
      foreignColumns: [brokerAccounts.ownerUserId, brokerAccounts.id],
    }).onDelete('restrict'),
    check('full_balance_report_checkpoints_evidence_check', sql`
      ${table.genericAsOf} AND ${table.manuallyConfirmed} AND
      ${table.allRelevantPagesReviewed} AND ${table.fingerprintVersion} = 2`),
    check('full_balance_report_checkpoints_fingerprint_check',
      sql`${table.fingerprint} ~ '^[0-9a-f]{64}$'`),
    check('full_balance_report_checkpoints_counts_check', sql`
      ${table.depositCount} BETWEEN 0 AND 100 AND
      ${table.collateralCount} BETWEEN 0 AND 100 AND
      ${table.domesticStockLotCount} BETWEEN 0 AND 100 AND
      ${table.fundBalanceCount} BETWEEN 0 AND 100 AND
      ${table.marginCount} BETWEEN 0 AND 100`),
    check('full_balance_report_checkpoints_source_page_count_check',
      sql`${table.sourcePageCount} BETWEEN 1 AND 100`),
    pgPolicy('full_balance_report_checkpoints_owner_select', {
      for: 'select', to: 'public',
      using: sql`${table.ownerUserId} = nullif(current_setting('app.current_user_id', true), '')`,
    }),
    pgPolicy('full_balance_report_checkpoints_owner_insert', {
      for: 'insert', to: 'public',
      withCheck: sql`${table.ownerUserId} = nullif(current_setting('app.current_user_id', true), '')`,
    }),
  ],
);

export const fullBalanceReportSections = pgTable.withRLS(
  'full_balance_report_sections',
  {
    ownerUserId: text('owner_user_id').notNull().references(() => authUsers.id, { onDelete: 'restrict' }),
    brokerAccountId: uuid('broker_account_id').notNull(),
    checkpointId: uuid('checkpoint_id').notNull(),
    sectionKind: text('section_kind').notNull(),
    evidenceState: text('evidence_state').notNull(),
    declaredCount: integer('declared_count').notNull(),
  },
  (table) => [
    uniqueIndex('full_balance_report_sections_identity_uidx')
      .on(table.ownerUserId, table.brokerAccountId, table.checkpointId, table.sectionKind),
    foreignKey({
      name: 'full_balance_report_sections_owner_account_checkpoint_fk',
      columns: [table.ownerUserId, table.brokerAccountId, table.checkpointId],
      foreignColumns: [fullBalanceReportCheckpoints.ownerUserId,
        fullBalanceReportCheckpoints.brokerAccountId, fullBalanceReportCheckpoints.id],
    }).onDelete('restrict'),
    check('full_balance_report_sections_kind_check', sql`${table.sectionKind} IN
      ('deposits','collateral','domesticStockLots','fundBalances','margin','futures','options')`),
    check('full_balance_report_sections_state_check', sql`
      (${table.evidenceState} = 'explicit_zero' AND ${table.declaredCount} = 0) OR
      (${table.evidenceState} = 'reported' AND ${table.declaredCount} BETWEEN 1 AND 100)`),
    pgPolicy('full_balance_report_sections_owner_select', { for: 'select', to: 'public',
      using: sql`${table.ownerUserId} = nullif(current_setting('app.current_user_id', true), '')` }),
    pgPolicy('full_balance_report_sections_owner_insert', { for: 'insert', to: 'public',
      withCheck: sql`${table.ownerUserId} = nullif(current_setting('app.current_user_id', true), '')` }),
  ],
);

export const fullBalanceReportEntries = pgTable.withRLS(
  'full_balance_report_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerUserId: text('owner_user_id').notNull().references(() => authUsers.id, { onDelete: 'restrict' }),
    brokerAccountId: uuid('broker_account_id').notNull(),
    checkpointId: uuid('checkpoint_id').notNull(),
    sectionKind: text('section_kind').notNull(),
    entryKind: text('entry_kind').notNull(),
    rowIndex: integer('row_index'),
    sourcePage: integer('source_page').notNull(),
    sourceRow: integer('source_row').notNull(),
  },
  (table) => [
    uniqueIndex('full_balance_report_entries_owner_account_checkpoint_entry_uidx')
      .on(table.ownerUserId, table.brokerAccountId, table.checkpointId,
        table.sectionKind, table.rowIndex, table.id),
    uniqueIndex('full_balance_report_entries_checkpoint_locator_uidx')
      .on(table.checkpointId, table.sourcePage, table.sourceRow),
    uniqueIndex('full_balance_report_entries_checkpoint_section_index_uidx')
      .on(table.checkpointId, table.sectionKind, table.rowIndex),
    foreignKey({
      name: 'full_balance_report_entries_section_fk',
      columns: [table.ownerUserId, table.brokerAccountId, table.checkpointId, table.sectionKind],
      foreignColumns: [fullBalanceReportSections.ownerUserId, fullBalanceReportSections.brokerAccountId,
        fullBalanceReportSections.checkpointId, fullBalanceReportSections.sectionKind],
    }).onDelete('restrict'),
    check('full_balance_report_entries_shape_check', sql`
      ${table.sourcePage} BETWEEN 1 AND 100 AND ${table.sourceRow} BETWEEN 1 AND 100 AND
      ((${table.entryKind} = 'zero' AND ${table.rowIndex} IS NULL) OR
       (${table.entryKind} = 'row' AND ${table.rowIndex} BETWEEN 1 AND 100))`),
    pgPolicy('full_balance_report_entries_owner_select', { for: 'select', to: 'public',
      using: sql`${table.ownerUserId} = nullif(current_setting('app.current_user_id', true), '')` }),
    pgPolicy('full_balance_report_entries_owner_insert', { for: 'insert', to: 'public',
      withCheck: sql`${table.ownerUserId} = nullif(current_setting('app.current_user_id', true), '')` }),
  ],
);

// Drizzle supplies table-bound extra-config columns whose internal generic table
// name differs for every child; this helper only consumes their SQL column shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const checkpointChild = (table: Record<'ownerUserId' | 'brokerAccountId' | 'checkpointId' | 'rowIndex' | 'sectionKind' | 'entryId', any>, prefix: string) => [
  uniqueIndex(`${prefix}_checkpoint_index_uidx`).on(table.checkpointId, table.sectionKind, table.rowIndex),
  foreignKey({
    name: `${prefix}_entry_fk`,
    columns: [table.ownerUserId, table.brokerAccountId, table.checkpointId,
      table.sectionKind, table.rowIndex, table.entryId],
    foreignColumns: [
      fullBalanceReportEntries.ownerUserId, fullBalanceReportEntries.brokerAccountId,
      fullBalanceReportEntries.checkpointId, fullBalanceReportEntries.sectionKind,
      fullBalanceReportEntries.rowIndex,
      fullBalanceReportEntries.id,
    ],
  }).onDelete('restrict'),
  check(`${prefix}_bounds_check`, sql`${table.rowIndex} BETWEEN 1 AND 100`),
  pgPolicy(`${prefix}_owner_select`, {
    for: 'select' as const, to: 'public',
    using: sql`${table.ownerUserId} = nullif(current_setting('app.current_user_id', true), '')`,
  }),
  pgPolicy(`${prefix}_owner_insert`, {
    for: 'insert' as const, to: 'public',
    withCheck: sql`${table.ownerUserId} = nullif(current_setting('app.current_user_id', true), '')`,
  }),
];

export const fullBalanceReportCashRows = pgTable.withRLS(
  'full_balance_report_cash_rows',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerUserId: text('owner_user_id').notNull().references(() => authUsers.id, { onDelete: 'restrict' }),
    brokerAccountId: uuid('broker_account_id').notNull(),
    checkpointId: uuid('checkpoint_id').notNull(),
    entryId: uuid('entry_id').notNull(),
    rowIndex: integer('row_index').notNull(),
    sectionKind: text('section_kind').notNull(),
    sourceKind: text('source_kind').notNull(),
    amount: numeric('amount', { precision: 20, scale: 2, mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    ...checkpointChild(table, 'full_balance_report_cash_rows'),
    check('full_balance_report_cash_rows_kind_check', sql`
      (${table.sectionKind} = 'deposits' AND ${table.sourceKind} = 'cash_deposit') OR
      (${table.sectionKind} = 'collateral' AND ${table.sourceKind} IN
        ('margin_guarantee', 'stock_lending_collateral', 'futures_options_margin'))`),
    check('full_balance_report_cash_rows_amount_check', sql`${table.amount} > 0`),
  ],
);

export const fullBalanceReportStockLots = pgTable.withRLS(
  'full_balance_report_stock_lots',
  {
    id: uuid('id').defaultRandom().primaryKey(), ownerUserId: text('owner_user_id').notNull().references(() => authUsers.id, { onDelete: 'restrict' }),
    brokerAccountId: uuid('broker_account_id').notNull(), checkpointId: uuid('checkpoint_id').notNull(),
    entryId: uuid('entry_id').notNull(), sectionKind: text('section_kind').notNull(),
    rowIndex: integer('row_index').notNull(),
    securityCode: text('security_code').notNull(), securityName: text('security_name').notNull(),
    acquisitionDate: date('acquisition_date', { mode: 'string' }).notNull(),
    quantity: numeric('quantity', { precision: 24, scale: 6, mode: 'string' }).notNull(),
    acquisitionUnitPriceState: text('acquisition_unit_price_state').notNull(),
    purchaseAmountState: text('purchase_amount_state').notNull(),
    acquisitionUnitPrice: numeric('acquisition_unit_price', { precision: 24, scale: 6, mode: 'string' }),
    purchaseAmount: numeric('purchase_amount', { precision: 20, scale: 2, mode: 'string' }),
    referencePrice: numeric('reference_price', { precision: 24, scale: 6, mode: 'string' }),
    evaluationAmount: numeric('evaluation_amount', { precision: 20, scale: 2, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    ...checkpointChild(table, 'full_balance_report_stock_lots'),
    check('full_balance_report_stock_lots_code_check', sql`${table.securityCode} ~ '^(?:[0-9][0-9A-HJ-NP-UW-Y][0-9][0-9A-HJ-NP-UW-Y]|[0-9]{3}\\.[0-9]{2})$'`),
    check('full_balance_report_stock_lots_values_check', sql`
      char_length(${table.securityName}) BETWEEN 1 AND 100 AND ${table.quantity} > 0 AND
      ((${table.acquisitionUnitPriceState} = 'reported' AND ${table.acquisitionUnitPrice} > 0) OR
       (${table.acquisitionUnitPriceState} IN ('masked','absent') AND ${table.acquisitionUnitPrice} IS NULL)) AND
      ((${table.purchaseAmountState} = 'reported' AND ${table.purchaseAmount} > 0) OR
       (${table.purchaseAmountState} IN ('masked','absent') AND ${table.purchaseAmount} IS NULL)) AND
      (${table.referencePrice} IS NULL OR ${table.referencePrice} > 0) AND
      (${table.evaluationAmount} IS NULL OR ${table.evaluationAmount} > 0)`),
    check('full_balance_report_stock_lots_section_check',
      sql`${table.sectionKind} = 'domesticStockLots'`),
  ],
);

export const fullBalanceReportFundBalances = pgTable.withRLS(
  'full_balance_report_fund_balances',
  {
    id: uuid('id').defaultRandom().primaryKey(), ownerUserId: text('owner_user_id').notNull().references(() => authUsers.id, { onDelete: 'restrict' }),
    brokerAccountId: uuid('broker_account_id').notNull(), checkpointId: uuid('checkpoint_id').notNull(),
    entryId: uuid('entry_id').notNull(), sectionKind: text('section_kind').notNull(),
    rowIndex: integer('row_index').notNull(),
    securityCode: text('security_code').notNull(), securityName: text('security_name').notNull(),
    units: numeric('units', { precision: 24, scale: 6, mode: 'string' }).notNull(),
    referencePrice: numeric('reference_price', { precision: 24, scale: 6, mode: 'string' }).notNull(),
    evaluationAmount: numeric('evaluation_amount', { precision: 20, scale: 2, mode: 'string' }).notNull(),
    referencePriceUnit: numeric('reference_price_unit', { precision: 24, scale: 6, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    ...checkpointChild(table, 'full_balance_report_fund_balances'),
    check('full_balance_report_fund_balances_code_check', sql`${table.securityCode} ~ '^(?:[0-9][0-9A-HJ-NP-UW-Y][0-9][0-9A-HJ-NP-UW-Y]|[0-9]{3}\\.[0-9]{2})$'`),
    check('full_balance_report_fund_balances_values_check', sql`
      char_length(${table.securityName}) BETWEEN 1 AND 100 AND ${table.units} > 0 AND
      ${table.referencePrice} > 0 AND ${table.evaluationAmount} > 0 AND
      (${table.referencePriceUnit} IS NULL OR ${table.referencePriceUnit} > 0)`),
    check('full_balance_report_fund_balances_section_check',
      sql`${table.sectionKind} = 'fundBalances'`),
  ],
);

export const fullBalanceReportMarginRows = pgTable.withRLS(
  'full_balance_report_margin_rows',
  {
    id: uuid('id').defaultRandom().primaryKey(), ownerUserId: text('owner_user_id').notNull().references(() => authUsers.id, { onDelete: 'restrict' }),
    brokerAccountId: uuid('broker_account_id').notNull(), checkpointId: uuid('checkpoint_id').notNull(),
    entryId: uuid('entry_id').notNull(), sectionKind: text('section_kind').notNull(),
    rowIndex: integer('row_index').notNull(),
    state: text('state').notNull(), securityCode: text('security_code').notNull(), securityName: text('security_name').notNull(),
    repaymentTermLabel: text('repayment_term_label').notNull(), designationLabel: text('designation_label'),
    quantity: numeric('quantity', { precision: 24, scale: 6, mode: 'string' }).notNull(), market: text('market').notNull(),
    side: text('side').notNull(), contractDate: date('contract_date', { mode: 'string' }).notNull(),
    contractUnitPrice: numeric('contract_unit_price', { precision: 24, scale: 6, mode: 'string' }).notNull(),
    currentPrice: numeric('current_price', { precision: 24, scale: 6, mode: 'string' }),
    fees: numeric('fees', { precision: 20, scale: 2, mode: 'string' }),
    unrealizedPnl: numeric('unrealized_pnl', { precision: 20, scale: 2, mode: 'string' }),
    finalSettlementOrPlannedDate: date('final_settlement_or_planned_date', { mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    ...checkpointChild(table, 'full_balance_report_margin_rows'),
    check('full_balance_report_margin_rows_code_check', sql`${table.securityCode} ~ '^(?:[0-9][0-9A-HJ-NP-UW-Y][0-9][0-9A-HJ-NP-UW-Y]|[0-9]{3}\\.[0-9]{2})$'`),
    check('full_balance_report_margin_rows_values_check', sql`
      char_length(${table.securityName}) BETWEEN 1 AND 100 AND
      char_length(${table.repaymentTermLabel}) BETWEEN 1 AND 50 AND
      (${table.designationLabel} IS NULL OR char_length(${table.designationLabel}) BETWEEN 1 AND 50) AND
      ${table.market} IN ('tokyo','private','nagoya','fukuoka','sapporo') AND
      ${table.quantity} > 0 AND ${table.contractUnitPrice} > 0 AND ${table.side} IN ('buy', 'sell') AND
      (${table.currentPrice} IS NULL OR ${table.currentPrice} > 0) AND
      (${table.fees} IS NULL OR ${table.fees} >= 0) AND
      ${table.state} IN ('open', 'settled') AND
      ${table.finalSettlementOrPlannedDate} >= ${table.contractDate}`),
    check('full_balance_report_margin_rows_section_check',
      sql`${table.sectionKind} = 'margin'`),
  ],
);

export const authSessions = pgTable('auth_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => authUsers.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  authMethod: text('auth_method'),
  authenticatedAt: timestamp('authenticated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const deviceEnrollmentGrants = pgTable(
  'device_enrollment_grants',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    sourceSessionId: uuid('source_session_id')
      .notNull()
      .references(() => authSessions.id, { onDelete: 'cascade' }),
    purpose: text('purpose').notNull(),
    challenge: text('challenge').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('device_enrollment_grants_expires_at_idx').on(table.expiresAt),
    index('device_enrollment_grants_user_id_idx').on(table.userId),
    index('device_enrollment_grants_source_session_id_idx').on(table.sourceSessionId),
    check('device_enrollment_grants_purpose_check', sql`${table.purpose} = 'add_device'`),
    check(
      'device_enrollment_grants_expiry_window_check',
      sql`${table.expiresAt} > ${table.createdAt} AND ${table.expiresAt} <= ${table.createdAt} + interval '5 minutes'`,
    ),
  ],
);

export const passkeyCredentials = pgTable('passkey_credentials', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => authUsers.id, { onDelete: 'cascade' }),
  publicKey: bytea('public_key').notNull(),
  counter: bigint('counter', { mode: 'number' }).notNull().default(0),
  deviceType: text('device_type').notNull(),
  backedUp: boolean('backed_up').notNull(),
  transports: text('transports').array(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const authChallenges = pgTable(
  'auth_challenges',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    challenge: text('challenge').notNull().unique(),
    ceremony: text('ceremony').notNull(),
    contextHash: text('context_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('auth_challenges_expires_at_idx').on(table.expiresAt)],
);
