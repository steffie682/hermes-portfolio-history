import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { authenticatedPrincipalId, type AuthenticatedPrincipal } from '@/auth/session';
import type { AppDatabase } from '@/db/client';
import type { AssetEvidence, AssetEvidenceSectionKind, AssetEvidenceState } from '@/asset-summary/domain';
import {
  brokerAccounts,
  importBatches,
  ledgerEvents,
  stagedEvents,
  fullBalanceReportCashRows,
  fullBalanceReportCheckpoints,
  fullBalanceReportEntries,
  fullBalanceReportFundBalances,
  fullBalanceReportMarginRows,
  fullBalanceReportSections,
  fullBalanceReportStockLots,
} from '@/db/schema';
import {
  fingerprintFullBalanceReportCheckpoint,
  type FullBalanceReportCheckpoint,
} from './full-balance-report-checkpoint';

export class FullBalanceReportCheckpointRepositoryError extends Error {
  constructor(readonly code: 'invalid_account') {
    super(code);
  }
}

const summarySelection = {
  id: fullBalanceReportCheckpoints.id,
  statementDate: fullBalanceReportCheckpoints.statementDate,
  depositCount: fullBalanceReportCheckpoints.depositCount,
  collateralCount: fullBalanceReportCheckpoints.collateralCount,
  domesticStockLotCount: fullBalanceReportCheckpoints.domesticStockLotCount,
  fundBalanceCount: fullBalanceReportCheckpoints.fundBalanceCount,
  marginCount: fullBalanceReportCheckpoints.marginCount,
  unresolvedSectionCount: fullBalanceReportCheckpoints.unresolvedSectionCount,
};

const mergeSelection = {
  ...summarySelection,
  createdAt: fullBalanceReportCheckpoints.createdAt,
};

function summary(row: typeof summarySelection extends Record<string, infer T> ? Record<string, T> : never) {
  const value = row as unknown as {
    id: string; statementDate: string; depositCount: number; collateralCount: number;
    domesticStockLotCount: number; fundBalanceCount: number; marginCount: number;
    unresolvedSectionCount: number;
  };
  return {
    id: value.id,
    statementDate: value.statementDate,
    rowCount: value.depositCount + value.collateralCount + value.domesticStockLotCount
      + value.fundBalanceCount + value.marginCount,
    unresolvedSectionCount: value.unresolvedSectionCount,
  };
}

export function createFullBalanceReportCheckpointRepository(db: AppDatabase) {
  return {
    async save(principal: AuthenticatedPrincipal, input: FullBalanceReportCheckpoint) {
      const ownerUserId = authenticatedPrincipalId(principal);
      const fingerprint = fingerprintFullBalanceReportCheckpoint(ownerUserId, input);
      return db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.current_user_id', ${ownerUserId}, true)`);
        const [account] = await tx.select({ id: brokerAccounts.id }).from(brokerAccounts)
          .where(and(
            eq(brokerAccounts.ownerUserId, ownerUserId),
            eq(brokerAccounts.id, input.brokerAccountId),
            eq(brokerAccounts.broker, 'sbi'),
          )).limit(1);
        if (!account) throw new FullBalanceReportCheckpointRepositoryError('invalid_account');

        const unresolvedSectionCount = [input.deposits, input.collateral, input.domesticStockLots,
          input.fundBalances, input.margin].filter((section) => section.evidenceState === 'missing').length;
        const [inserted] = await tx.insert(fullBalanceReportCheckpoints).values({
          ownerUserId, brokerAccountId: account.id, statementDate: input.statementDate, fingerprint,
          sourcePageCount: input.sourcePageCount,
          genericAsOf: true, manuallyConfirmed: true,
          allRelevantPagesReviewed: input.allRelevantPagesReviewed, fingerprintVersion: 2,
          depositCount: input.deposits.rows.length,
          collateralCount: input.collateral.rows.length,
          domesticStockLotCount: input.domesticStockLots.rows.length,
          fundBalanceCount: input.fundBalances.rows.length,
          marginCount: input.margin.rows.length, unresolvedSectionCount,
        }).onConflictDoNothing({
          target: [fullBalanceReportCheckpoints.ownerUserId, fullBalanceReportCheckpoints.fingerprint],
        }).returning(summarySelection);

        if (!inserted) {
          const [existing] = await tx.select(summarySelection).from(fullBalanceReportCheckpoints)
            .where(and(
              eq(fullBalanceReportCheckpoints.ownerUserId, ownerUserId),
              eq(fullBalanceReportCheckpoints.fingerprint, fingerprint),
            )).limit(1);
          if (!existing) throw new Error('Checkpoint replay unavailable');
          return { created: false as const, checkpoint: summary(existing as never) };
        }

        const common = { ownerUserId, brokerAccountId: account.id, checkpointId: inserted.id };
        const sections = [
          ['deposits', input.deposits], ['collateral', input.collateral],
          ['domesticStockLots', input.domesticStockLots], ['fundBalances', input.fundBalances],
          ['margin', input.margin], ['futures', input.futures], ['options', input.options],
        ] as const;
        await tx.insert(fullBalanceReportSections).values(sections.map(([sectionKind, section]) => ({
          ...common, sectionKind, evidenceState: section.evidenceState,
          declaredCount: section.rows.length,
        })));
        const entryIds = new Map<string, string>();
        for (const [sectionKind, section] of sections) {
          const values: Array<typeof fullBalanceReportEntries.$inferInsert> = [];
          if (section.evidenceState === 'explicit_zero') {
            const zeroLocator = section.zeroLocator;
            if (!zeroLocator) throw new Error('Missing validated zero locator');
            values.push({
              ...common, sectionKind, entryKind: 'zero', rowIndex: null,
              sourcePage: zeroLocator.sourcePage,
              sourceRow: zeroLocator.sourceRow,
            });
          } else {
            for (const [index, row] of section.rows.entries()) {
              values.push({
                ...common, sectionKind, entryKind: 'row', rowIndex: index + 1,
                sourcePage: row.sourcePage, sourceRow: row.sourceRow,
              });
            }
          }
          if (values.length === 0) continue;
          const created = await tx.insert(fullBalanceReportEntries).values(values).returning({
            id: fullBalanceReportEntries.id, rowIndex: fullBalanceReportEntries.rowIndex,
          });
          for (const entry of created) {
            if (entry.rowIndex !== null) entryIds.set(`${sectionKind}:${entry.rowIndex}`, entry.id);
          }
        }
        const cashRows = [
          ...input.deposits.rows.map((row, index) => ({
            ...common, entryId: entryIds.get(`deposits:${index + 1}`)!, rowIndex: index + 1,
            sectionKind: 'deposits', sourceKind: row.kind, amount: row.amount,
          })),
          ...input.collateral.rows.map((row, index) => ({
            ...common, entryId: entryIds.get(`collateral:${index + 1}`)!, rowIndex: index + 1,
            sectionKind: 'collateral', sourceKind: row.kind, amount: row.amount,
          })),
        ];
        if (cashRows.length) await tx.insert(fullBalanceReportCashRows).values(cashRows);
        if (input.domesticStockLots.rows.length) {
          await tx.insert(fullBalanceReportStockLots).values(input.domesticStockLots.rows.map((row, index) => ({
            ...common, entryId: entryIds.get(`domesticStockLots:${index + 1}`)!,
            sectionKind: 'domesticStockLots', rowIndex: index + 1,
            securityCode: row.securityCode, securityName: row.securityName,
            acquisitionDate: row.acquisitionDate, quantity: row.quantity,
            acquisitionUnitPriceState: row.acquisitionUnitPriceState,
            purchaseAmountState: row.purchaseAmountState,
            acquisitionUnitPrice: row.acquisitionUnitPrice, purchaseAmount: row.purchaseAmount,
            referencePrice: row.referencePrice, evaluationAmount: row.evaluationAmount,
          })));
        }
        if (input.fundBalances.rows.length) {
          await tx.insert(fullBalanceReportFundBalances).values(input.fundBalances.rows.map((row, index) => ({
            ...common, entryId: entryIds.get(`fundBalances:${index + 1}`)!,
            sectionKind: 'fundBalances', rowIndex: index + 1,
            securityCode: row.securityCode, securityName: row.securityName,
            units: row.units, referencePrice: row.referencePrice,
            evaluationAmount: row.evaluationAmount, referencePriceUnit: row.referencePriceUnit,
          })));
        }
        if (input.margin.rows.length) {
          await tx.insert(fullBalanceReportMarginRows).values(input.margin.rows.map((row, index) => ({
            ...common, entryId: entryIds.get(`margin:${index + 1}`)!,
            sectionKind: 'margin', rowIndex: index + 1,
            state: row.state, securityCode: row.securityCode, securityName: row.securityName,
            repaymentTermLabel: row.repaymentTermLabel, designationLabel: row.designationLabel,
            quantity: row.quantity, market: row.market, side: row.side,
            contractDate: row.contractDate, contractUnitPrice: row.contractUnitPrice,
            currentPrice: row.currentPrice, fees: row.fees, unrealizedPnl: row.unrealizedPnl,
            finalSettlementOrPlannedDate: row.finalSettlementOrPlannedDate,
          })));
        }
        return { created: true as const, checkpoint: summary(inserted as never) };
      });
    },

    async listLatestEvidence(principal: AuthenticatedPrincipal, limitAccounts = 10): Promise<AssetEvidence[]> {
      const ownerUserId = authenticatedPrincipalId(principal);
      return db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.current_user_id', ${ownerUserId}, true)`);
        const validLimit = Number.isSafeInteger(limitAccounts) && limitAccounts > 0
          ? limitAccounts
          : 10;
        const cappedLimit = Math.min(validLimit, 10);
        const ranked = tx.$with('ranked_balance_evidence').as(
          tx.select({
            checkpointId: fullBalanceReportCheckpoints.id,
            brokerAccountId: fullBalanceReportCheckpoints.brokerAccountId,
            accountName: brokerAccounts.displayName,
            statementDate: fullBalanceReportCheckpoints.statementDate,
            createdAt: fullBalanceReportCheckpoints.createdAt,
            evidenceRank: sql<number>`row_number() over (
              partition by ${fullBalanceReportCheckpoints.brokerAccountId}
              order by ${fullBalanceReportCheckpoints.statementDate} desc,
                ${fullBalanceReportCheckpoints.createdAt} desc,
                ${fullBalanceReportCheckpoints.id} desc
            )`.as('evidence_rank'),
          }).from(fullBalanceReportCheckpoints)
            .innerJoin(brokerAccounts, and(
              eq(brokerAccounts.id, fullBalanceReportCheckpoints.brokerAccountId),
              eq(brokerAccounts.ownerUserId, fullBalanceReportCheckpoints.ownerUserId),
            ))
            .where(and(
              eq(fullBalanceReportCheckpoints.ownerUserId, ownerUserId),
              eq(brokerAccounts.ownerUserId, ownerUserId),
              eq(brokerAccounts.broker, 'sbi'),
            )),
        );
        const latest = await tx.with(ranked).select({
          checkpointId: ranked.checkpointId,
          brokerAccountId: ranked.brokerAccountId,
          accountName: ranked.accountName,
          statementDate: ranked.statementDate,
          createdAt: ranked.createdAt,
        }).from(ranked)
          .where(eq(ranked.evidenceRank, 1))
          .orderBy(
            desc(ranked.statementDate), desc(ranked.createdAt), desc(ranked.checkpointId),
          )
          .limit(cappedLimit);
        if (latest.length === 0) return [];
        const checkpointIds = latest.map((row) => row.checkpointId);
        const locator = {
          sourcePage: fullBalanceReportEntries.sourcePage,
          sourceRow: fullBalanceReportEntries.sourceRow,
        };
        const [cash, stocks, funds, margin, sectionRows] = await Promise.all([
          tx.select({
            checkpointId: fullBalanceReportCashRows.checkpointId,
            sectionKind: fullBalanceReportCashRows.sectionKind,
            kind: fullBalanceReportCashRows.sourceKind,
            amount: fullBalanceReportCashRows.amount,
            ...locator,
          }).from(fullBalanceReportCashRows)
            .innerJoin(fullBalanceReportEntries, eq(fullBalanceReportCashRows.entryId, fullBalanceReportEntries.id))
            .where(and(
              eq(fullBalanceReportCashRows.ownerUserId, ownerUserId),
              inArray(fullBalanceReportCashRows.checkpointId, checkpointIds),
            )).orderBy(fullBalanceReportCashRows.rowIndex),
          tx.select({
            checkpointId: fullBalanceReportStockLots.checkpointId,
            securityCode: fullBalanceReportStockLots.securityCode,
            securityName: fullBalanceReportStockLots.securityName,
            quantity: fullBalanceReportStockLots.quantity,
            evaluationAmount: fullBalanceReportStockLots.evaluationAmount,
            ...locator,
          }).from(fullBalanceReportStockLots)
            .innerJoin(fullBalanceReportEntries, eq(fullBalanceReportStockLots.entryId, fullBalanceReportEntries.id))
            .where(and(
              eq(fullBalanceReportStockLots.ownerUserId, ownerUserId),
              inArray(fullBalanceReportStockLots.checkpointId, checkpointIds),
            )).orderBy(fullBalanceReportStockLots.rowIndex),
          tx.select({
            checkpointId: fullBalanceReportFundBalances.checkpointId,
            securityCode: fullBalanceReportFundBalances.securityCode,
            securityName: fullBalanceReportFundBalances.securityName,
            units: fullBalanceReportFundBalances.units,
            evaluationAmount: fullBalanceReportFundBalances.evaluationAmount,
            ...locator,
          }).from(fullBalanceReportFundBalances)
            .innerJoin(fullBalanceReportEntries, eq(fullBalanceReportFundBalances.entryId, fullBalanceReportEntries.id))
            .where(and(
              eq(fullBalanceReportFundBalances.ownerUserId, ownerUserId),
              inArray(fullBalanceReportFundBalances.checkpointId, checkpointIds),
            )).orderBy(fullBalanceReportFundBalances.rowIndex),
          tx.select({
            checkpointId: fullBalanceReportMarginRows.checkpointId,
            state: fullBalanceReportMarginRows.state,
            side: fullBalanceReportMarginRows.side,
            securityCode: fullBalanceReportMarginRows.securityCode,
            securityName: fullBalanceReportMarginRows.securityName,
            quantity: fullBalanceReportMarginRows.quantity,
            unrealizedPnl: fullBalanceReportMarginRows.unrealizedPnl,
            ...locator,
          }).from(fullBalanceReportMarginRows)
            .innerJoin(fullBalanceReportEntries, eq(fullBalanceReportMarginRows.entryId, fullBalanceReportEntries.id))
            .where(and(
              eq(fullBalanceReportMarginRows.ownerUserId, ownerUserId),
              inArray(fullBalanceReportMarginRows.checkpointId, checkpointIds),
            )).orderBy(fullBalanceReportMarginRows.rowIndex),
          tx.select({
            checkpointId: fullBalanceReportSections.checkpointId,
            sectionKind: fullBalanceReportSections.sectionKind,
            evidenceState: fullBalanceReportSections.evidenceState,
          }).from(fullBalanceReportSections)
            .where(and(
              eq(fullBalanceReportSections.ownerUserId, ownerUserId),
              inArray(fullBalanceReportSections.checkpointId, checkpointIds),
            )),
        ]);
        const sectionKinds: AssetEvidenceSectionKind[] = [
          'deposits', 'collateral', 'domesticStockLots', 'fundBalances', 'margin', 'futures', 'options',
        ];
        return latest.map((checkpoint): AssetEvidence => {
          const matchedSections = sectionRows.filter((row) => row.checkpointId === checkpoint.checkpointId);
          const sections = Object.fromEntries(matchedSections.map((row) => [
            row.sectionKind, row.evidenceState,
          ])) as Partial<Record<AssetEvidenceSectionKind, AssetEvidenceState>>;
          if (sectionKinds.some((kind) => sections[kind] === undefined)) {
            throw new Error('Incomplete balance evidence sections');
          }
          return {
          checkpointId: checkpoint.checkpointId,
          brokerAccountId: checkpoint.brokerAccountId,
          accountName: checkpoint.accountName,
          statementDate: checkpoint.statementDate,
          sections: sections as Record<AssetEvidenceSectionKind, AssetEvidenceState>,
          deposits: cash.filter((row) => row.checkpointId === checkpoint.checkpointId
            && row.sectionKind === 'deposits').map((row) => ({
              kind: 'cash_deposit', amount: row.amount,
              sourcePage: row.sourcePage, sourceRow: row.sourceRow,
            })),
          collateral: cash.filter((row) => row.checkpointId === checkpoint.checkpointId
            && row.sectionKind === 'collateral').map((row) => ({
              kind: row.kind as AssetEvidence['collateral'][number]['kind'], amount: row.amount,
              sourcePage: row.sourcePage, sourceRow: row.sourceRow,
            })),
          domesticStockLots: stocks.filter((row) => row.checkpointId === checkpoint.checkpointId)
            .map((row) => ({
              securityCode: row.securityCode, securityName: row.securityName, quantity: row.quantity,
              evaluationAmount: row.evaluationAmount, sourcePage: row.sourcePage, sourceRow: row.sourceRow,
            })),
          fundBalances: funds.filter((row) => row.checkpointId === checkpoint.checkpointId)
            .map((row) => ({
              securityCode: row.securityCode, securityName: row.securityName, units: row.units,
              evaluationAmount: row.evaluationAmount, sourcePage: row.sourcePage, sourceRow: row.sourceRow,
            })),
          margin: margin.filter((row) => row.checkpointId === checkpoint.checkpointId).map((row) => ({
            state: row.state as 'open' | 'settled', side: row.side as 'buy' | 'sell',
            securityCode: row.securityCode, securityName: row.securityName,
            quantity: row.quantity, unrealizedPnl: row.unrealizedPnl,
            sourcePage: row.sourcePage, sourceRow: row.sourceRow,
          })),
          };
        });
      });
    },

    async getImportReadiness(principal: AuthenticatedPrincipal) {
      const ownerUserId = authenticatedPrincipalId(principal);
      return db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.current_user_id', ${ownerUserId}, true)`);
        const [ledger, needsReview, unresolvedDistribution, previewReady] = await Promise.all([
          tx.select({ value: sql<number>`count(*)::int` }).from(ledgerEvents)
            .where(eq(ledgerEvents.ownerUserId, ownerUserId)),
          tx.select({ value: sql<number>`count(*)::int` }).from(stagedEvents)
            .where(and(
              eq(stagedEvents.ownerUserId, ownerUserId),
              eq(stagedEvents.status, 'needs_review'),
            )),
          tx.select({ value: sql<number>`count(*)::int` }).from(stagedEvents)
            .where(and(
              eq(stagedEvents.ownerUserId, ownerUserId),
              eq(stagedEvents.status, 'needs_review'),
              eq(stagedEvents.reasonCode, 'needs-distribution-details'),
            )),
          tx.select({ value: sql<number>`count(*)::int` }).from(importBatches)
            .where(and(
              eq(importBatches.ownerUserId, ownerUserId),
              eq(importBatches.status, 'preview_ready'),
            )),
        ]);
        return {
          ledgerEventCount: ledger[0]?.value ?? 0,
          unresolvedDistributionCount: unresolvedDistribution[0]?.value ?? 0,
          otherNeedsReviewCount: Math.max(
            (needsReview[0]?.value ?? 0) - (unresolvedDistribution[0]?.value ?? 0),
            0,
          ),
          previewReadyBatchCount: previewReady[0]?.value ?? 0,
        };
      });
    },

    async listRecent(principal: AuthenticatedPrincipal, limit = 10) {
      const ownerUserId = authenticatedPrincipalId(principal);
      return db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.current_user_id', ${ownerUserId}, true)`);
        const rows = await tx.select(summarySelection).from(fullBalanceReportCheckpoints)
          .where(eq(fullBalanceReportCheckpoints.ownerUserId, ownerUserId))
          .orderBy(desc(fullBalanceReportCheckpoints.createdAt))
          .limit(Math.min(Math.max(limit, 1), 20));
        return rows.map((row) => summary(row as never));
      });
    },

    async listRecentForMerge(principal: AuthenticatedPrincipal, limit = 10) {
      const ownerUserId = authenticatedPrincipalId(principal);
      return db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.current_user_id', ${ownerUserId}, true)`);
        const rows = await tx.select(mergeSelection).from(fullBalanceReportCheckpoints)
          .where(eq(fullBalanceReportCheckpoints.ownerUserId, ownerUserId))
          .orderBy(desc(fullBalanceReportCheckpoints.createdAt))
          .limit(Math.min(Math.max(limit, 1), 20));
        return rows.map((row) => ({
          ...summary(row as never),
          createdAt: row.createdAt,
        }));
      });
    },
  };
}
