import { createHash, randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import {
  authenticatedPrincipalId,
  type AuthenticatedPrincipal,
} from '@/auth/session';
import type { AppDatabase } from '@/db/client';
import {
  brokerAccounts,
  importBatches,
  ledgerEvents,
  privateSourceObjects,
  sourceDocuments,
  sourceRecords,
  stagedEvents,
} from '@/db/schema';
import {
  privateSourceStorageKey,
  type PrivateSourceStorage,
} from './private-source-storage';
import { inspectSbiSourceFile } from './source-file-intake';

const PARSER_NAME = 'sbi-trade-history';
const PARSER_VERSION = '1';

type Transaction = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== 'sourceRowNumber')
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function economicFingerprint(input: {
  brokerAccountId: string;
  eventKind: string;
  payload: unknown;
}) {
  return sha256(JSON.stringify({
    version: 1,
    brokerAccountId: input.brokerAccountId,
    eventKind: input.eventKind,
    payload: canonicalize(input.payload),
  }));
}

async function duplicateResult(tx: Transaction, sourceDocumentId: string) {
  const [batch] = await tx
    .select({ id: importBatches.id, status: importBatches.status })
    .from(importBatches)
    .where(eq(importBatches.sourceDocumentId, sourceDocumentId))
    .limit(1);
  if (!batch) throw new Error('Import batch is unavailable');
  const stagedCounts = await tx
    .select({
      status: stagedEvents.status,
      value: sql<number>`count(*)::int`,
    })
    .from(stagedEvents)
    .where(eq(stagedEvents.batchId, batch.id))
    .groupBy(stagedEvents.status);
  const counts = { new: 0, duplicate: 0, needsReview: 0, rejected: 0 };
  for (const staged of stagedCounts) {
    if (staged.status === 'needs_review') counts.needsReview += staged.value;
    else if (staged.status === 'rejected') counts.rejected += staged.value;
    else if (staged.status === 'duplicate' || batch.status === 'committed') {
      counts.duplicate += staged.value;
    } else counts.new += staged.value;
  }
  return {
    batchId: batch.id,
    disposition: 'duplicate' as const,
    counts,
  };
}

async function preflightSource(
  db: AppDatabase,
  ownerUserId: string,
  brokerAccountId: string,
  contentSha256: string,
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_user_id', ${ownerUserId}, true)`);
    const [account] = await tx
      .select({ id: brokerAccounts.id })
      .from(brokerAccounts)
      .where(and(
        eq(brokerAccounts.id, brokerAccountId),
        eq(brokerAccounts.ownerUserId, ownerUserId),
        eq(brokerAccounts.broker, 'sbi'),
      ))
      .limit(1);
    if (!account) throw new Error('Broker account is unavailable');
    const [existingSource] = await tx
      .select({ id: sourceDocuments.id })
      .from(sourceDocuments)
      .where(and(
        eq(sourceDocuments.ownerUserId, ownerUserId),
        eq(sourceDocuments.brokerAccountId, account.id),
        eq(sourceDocuments.contentSha256, contentSha256),
      ))
      .limit(1);
    return existingSource ? duplicateResult(tx, existingSource.id) : null;
  });
}

async function trackPendingStorageObject(input: {
  db: AppDatabase;
  ownerUserId: string;
  brokerAccountId: string;
  sourceDocumentId: string;
  storageKey: string;
}) {
  await input.db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_user_id', ${input.ownerUserId}, true)`);
    await tx.insert(privateSourceObjects).values({
      id: input.sourceDocumentId,
      ownerUserId: input.ownerUserId,
      brokerAccountId: input.brokerAccountId,
      storageKey: input.storageKey,
      status: 'pending_upload',
    });
  });
}

async function cleanupTrackedStorageObject(input: {
  db: AppDatabase;
  storage: PrivateSourceStorage;
  ownerUserId: string;
  sourceDocumentId: string;
}) {
  return input.db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_user_id', ${input.ownerUserId}, true)`);
    const [tracked] = await tx
      .select({
        id: privateSourceObjects.id,
        storageKey: privateSourceObjects.storageKey,
        status: privateSourceObjects.status,
      })
      .from(privateSourceObjects)
      .where(and(
        eq(privateSourceObjects.id, input.sourceDocumentId),
        eq(privateSourceObjects.ownerUserId, input.ownerUserId),
      ))
      .limit(1)
      .for('update');
    if (!tracked || tracked.status === 'retained') return false;
    try {
      await input.storage.delete(tracked.storageKey);
    } catch {
      await tx
        .update(privateSourceObjects)
        .set({
          status: 'cleanup_pending',
          cleanupAttempts: sql`${privateSourceObjects.cleanupAttempts} + 1`,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(privateSourceObjects.id, tracked.id));
      return false;
    }
    await tx
      .delete(privateSourceObjects)
      .where(and(
        eq(privateSourceObjects.id, tracked.id),
        eq(privateSourceObjects.ownerUserId, input.ownerUserId),
      ));
    return true;
  });
}

async function reconcileTrackedStorageObjects(input: {
  db: AppDatabase;
  storage: PrivateSourceStorage;
  ownerUserId: string;
}) {
  const candidates = await input.db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_user_id', ${input.ownerUserId}, true)`);
    return tx
      .select({ id: privateSourceObjects.id })
      .from(privateSourceObjects)
      .where(and(
        eq(privateSourceObjects.ownerUserId, input.ownerUserId),
        eq(privateSourceObjects.status, 'cleanup_pending'),
      ))
      .limit(20);
  });
  let cleaned = 0;
  for (const candidate of candidates) {
    if (await cleanupTrackedStorageObject({ ...input, sourceDocumentId: candidate.id })) cleaned += 1;
  }
  return { inspected: candidates.length, cleaned };
}

export function createImportRepository(
  db: AppDatabase,
  storage: PrivateSourceStorage,
) {
  return {
    async stageSbiTradeHistory(input: {
      principal: AuthenticatedPrincipal;
      brokerAccountId: string;
      mediaType: string;
      bytes: Uint8Array;
    }) {
      const ownerUserId = authenticatedPrincipalId(input.principal);
      const inspection = inspectSbiSourceFile({
        mediaType: input.mediaType,
        bytes: input.bytes,
      });
      await reconcileTrackedStorageObjects({ db, storage, ownerUserId });
      const duplicate = await preflightSource(
        db,
        ownerUserId,
        input.brokerAccountId,
        inspection.sha256,
      );
      if (duplicate) return duplicate;
      const sourceDocumentId = randomUUID();
      const expectedStorageKey = privateSourceStorageKey(ownerUserId, sourceDocumentId);
      await trackPendingStorageObject({
        db,
        ownerUserId,
        brokerAccountId: input.brokerAccountId,
        sourceDocumentId,
        storageKey: expectedStorageKey,
      });
      try {
        const stored = await storage.put({
          ownerUserId,
          sourceDocumentId,
          bytes: input.bytes,
        });
        if (stored.storageKey !== expectedStorageKey) {
          throw new Error('Private source storage key mismatch');
        }
        const result = await db.transaction(async (tx) => {
          await tx.execute(sql`select set_config('app.current_user_id', ${ownerUserId}, true)`);
          const [account] = await tx
            .select({ id: brokerAccounts.id })
            .from(brokerAccounts)
            .where(and(
              eq(brokerAccounts.id, input.brokerAccountId),
              eq(brokerAccounts.ownerUserId, ownerUserId),
              eq(brokerAccounts.broker, 'sbi'),
            ))
            .limit(1);
          if (!account) throw new Error('Broker account is unavailable');

          const [insertedSource] = await tx
            .insert(sourceDocuments)
            .values({
              id: sourceDocumentId,
              ownerUserId,
              brokerAccountId: account.id,
              contentSha256: inspection.sha256,
              mediaType: input.mediaType,
              byteSize: inspection.byteSize,
              storageKey: stored.storageKey,
              documentType: 'sbi_trade_history_csv',
              status: 'stored',
            })
            .onConflictDoNothing()
            .returning({ id: sourceDocuments.id });

          if (!insertedSource) {
            const [existingSource] = await tx
              .select({ id: sourceDocuments.id })
              .from(sourceDocuments)
              .where(and(
                eq(sourceDocuments.ownerUserId, ownerUserId),
                eq(sourceDocuments.brokerAccountId, account.id),
                eq(sourceDocuments.contentSha256, inspection.sha256),
              ))
              .limit(1);
            if (!existingSource) throw new Error('Import source conflict could not be resolved');
            return duplicateResult(tx, existingSource.id);
          }

          const [batch] = await tx
            .insert(importBatches)
            .values({
              ownerUserId,
              brokerAccountId: account.id,
              sourceDocumentId,
              parserName: PARSER_NAME,
              parserVersion: PARSER_VERSION,
              status: 'preview_ready',
            })
            .returning({ id: importBatches.id });

          const counts = { new: 0, duplicate: 0, needsReview: 0, rejected: 0 };
          const seenFingerprints = new Set<string>();
          for (const row of inspection.rows) {
            const locator = `csv:row:${row.sourceRowNumber}`;
            const [sourceRecord] = await tx
              .insert(sourceRecords)
              .values({
                ownerUserId,
                batchId: batch.id,
                sourceDocumentId,
                locator,
                sourcePage: null,
                sourceRow: row.sourceRowNumber,
                recordSha256: sha256(`${inspection.sha256}:${locator}`),
              })
              .returning({ id: sourceRecords.id });

            const fingerprint = row.status === 'new'
              ? economicFingerprint({
                  brokerAccountId: account.id,
                  eventKind: row.eventKind,
                  payload: row.payload,
                })
              : sha256(`${inspection.sha256}:${locator}:${row.reasonCode}`);
            const [committed] = await tx
              .select({ id: ledgerEvents.id })
              .from(ledgerEvents)
              .where(and(
                eq(ledgerEvents.ownerUserId, ownerUserId),
                eq(ledgerEvents.fingerprint, fingerprint),
              ))
              .limit(1);
            const status = committed || (row.status === 'new' && seenFingerprints.has(fingerprint))
              ? 'duplicate'
              : row.status;
            if (row.status === 'new') seenFingerprints.add(fingerprint);
            if (status === 'new') counts.new += 1;
            else if (status === 'duplicate') counts.duplicate += 1;
            else if (status === 'needs_review') counts.needsReview += 1;
            else counts.rejected += 1;

            await tx.insert(stagedEvents).values({
              ownerUserId,
              brokerAccountId: input.brokerAccountId,
              batchId: batch.id,
              sourceRecordId: sourceRecord.id,
              status,
              reasonCode: row.status === 'new' ? null : row.reasonCode,
              eventKind: row.status === 'new' ? row.eventKind : null,
              fingerprint,
              payload: row.status === 'new' ? row.payload : null,
            });
          }

          const [retainedObject] = await tx
            .update(privateSourceObjects)
            .set({ status: 'retained', updatedAt: sql`CURRENT_TIMESTAMP` })
            .where(and(
              eq(privateSourceObjects.id, sourceDocumentId),
              eq(privateSourceObjects.ownerUserId, ownerUserId),
              eq(privateSourceObjects.status, 'pending_upload'),
            ))
            .returning({ id: privateSourceObjects.id });
          if (!retainedObject) throw new Error('Private source upload is no longer active');
          return {
            batchId: batch.id,
            disposition: 'new' as const,
            counts,
          };
        });
        if (result.disposition === 'duplicate') {
          try {
            await cleanupTrackedStorageObject({ db, storage, ownerUserId, sourceDocumentId });
          } catch {
            // A successful duplicate classification must not be replaced by cleanup failure.
          }
        }
        return result;
      } catch (error) {
        try {
          await cleanupTrackedStorageObject({ db, storage, ownerUserId, sourceDocumentId });
        } catch {
          // The durable inventory row remains available for later reconciliation.
        }
        throw error;
      }
    },
    async reconcilePrivateSourceStorage(input: { principal: AuthenticatedPrincipal }) {
      return reconcileTrackedStorageObjects({
        db,
        storage,
        ownerUserId: authenticatedPrincipalId(input.principal),
      });
    },
    async getBatchTrace(input: {
      principal: AuthenticatedPrincipal;
      batchId: string;
    }) {
      const ownerUserId = authenticatedPrincipalId(input.principal);
      return db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.current_user_id', ${ownerUserId}, true)`);
        const [batch] = await tx
          .select({
            id: importBatches.id,
            status: importBatches.status,
            createdAt: importBatches.createdAt,
            committedAt: importBatches.committedAt,
          })
          .from(importBatches)
          .where(and(
            eq(importBatches.id, input.batchId),
            eq(importBatches.ownerUserId, ownerUserId),
          ))
          .limit(1);
        if (!batch) return null;
        const rows = await tx
          .select({
            sourceRow: sourceRecords.sourceRow,
            locator: sourceRecords.locator,
            status: stagedEvents.status,
            reasonCode: stagedEvents.reasonCode,
            eventKind: stagedEvents.eventKind,
            payload: stagedEvents.payload,
          })
          .from(sourceRecords)
          .innerJoin(stagedEvents, eq(stagedEvents.sourceRecordId, sourceRecords.id))
          .where(and(
            eq(sourceRecords.batchId, batch.id),
            eq(sourceRecords.ownerUserId, ownerUserId),
          ))
          .orderBy(sourceRecords.sourceRow);
        return {
          batchId: batch.id,
          status: batch.status,
          createdAt: batch.createdAt,
          committedAt: batch.committedAt,
          rows,
        };
      });
    },
    async commitBatch(input: {
      principal: AuthenticatedPrincipal;
      batchId: string;
    }) {
      const ownerUserId = authenticatedPrincipalId(input.principal);
      return db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.current_user_id', ${ownerUserId}, true)`);
        const [batch] = await tx
          .select({
            id: importBatches.id,
            status: importBatches.status,
            brokerAccountId: importBatches.brokerAccountId,
          })
          .from(importBatches)
          .where(and(
            eq(importBatches.id, input.batchId),
            eq(importBatches.ownerUserId, ownerUserId),
          ))
          .limit(1)
          .for('update');
        if (!batch) throw new Error('Import batch is unavailable');

        if (batch.status === 'preview_ready') {
          const candidates = await tx
            .select({
              id: stagedEvents.id,
              fingerprint: stagedEvents.fingerprint,
              eventKind: stagedEvents.eventKind,
              payload: stagedEvents.payload,
            })
            .from(stagedEvents)
            .where(and(
              eq(stagedEvents.batchId, batch.id),
              eq(stagedEvents.status, 'new'),
            ))
            .orderBy(stagedEvents.fingerprint, stagedEvents.id);
          for (const candidate of candidates) {
            if (!candidate.eventKind || candidate.payload === null) {
              throw new Error('Import event is not ready to commit');
            }
            const [inserted] = await tx
              .insert(ledgerEvents)
              .values({
                ownerUserId,
                brokerAccountId: batch.brokerAccountId,
                stagedEventId: candidate.id,
                fingerprint: candidate.fingerprint,
                eventKind: candidate.eventKind,
                payload: candidate.payload,
              })
              .onConflictDoNothing()
              .returning({ id: ledgerEvents.id });
            if (!inserted) {
              await tx
                .update(stagedEvents)
                .set({ status: 'duplicate' })
                .where(and(
                  eq(stagedEvents.id, candidate.id),
                  eq(stagedEvents.ownerUserId, ownerUserId),
                ));
            }
          }
          await tx
            .update(importBatches)
            .set({ status: 'committed', committedAt: sql`CURRENT_TIMESTAMP` })
            .where(eq(importBatches.id, batch.id));
        } else if (batch.status !== 'committed') {
          throw new Error('Import batch cannot be committed');
        }

        const [count] = await tx
          .select({ value: sql<number>`count(*)::int` })
          .from(ledgerEvents)
          .innerJoin(stagedEvents, eq(stagedEvents.id, ledgerEvents.stagedEventId))
          .where(and(
            eq(stagedEvents.batchId, batch.id),
            eq(ledgerEvents.ownerUserId, ownerUserId),
          ));
        return {
          batchId: batch.id,
          status: 'committed' as const,
          committed: count.value,
        };
      });
    },
  };
}
