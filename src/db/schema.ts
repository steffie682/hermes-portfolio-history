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
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
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
    pgPolicy('ledger_events_owner_isolation', {
      for: 'all', to: 'public',
      using: sql`${table.ownerUserId} = nullif(current_setting('app.current_user_id', true), '')`,
      withCheck: sql`${table.ownerUserId} = nullif(current_setting('app.current_user_id', true), '')`,
    }),
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
