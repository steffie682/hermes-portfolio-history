import { and, desc, eq, sql } from 'drizzle-orm';
import { authenticatedPrincipalId, type AuthenticatedPrincipal } from '@/auth/session';
import type { AppDatabase } from '@/db/client';
import {
  brokerAccounts,
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
};

const mergeSelection = {
  ...summarySelection,
  createdAt: fullBalanceReportCheckpoints.createdAt,
};

function summary(row: typeof summarySelection extends Record<string, infer T> ? Record<string, T> : never) {
  const value = row as unknown as {
    id: string; statementDate: string; depositCount: number; collateralCount: number;
    domesticStockLotCount: number; fundBalanceCount: number; marginCount: number;
  };
  return {
    id: value.id,
    statementDate: value.statementDate,
    rowCount: value.depositCount + value.collateralCount + value.domesticStockLotCount
      + value.fundBalanceCount + value.marginCount,
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

        const [inserted] = await tx.insert(fullBalanceReportCheckpoints).values({
          ownerUserId, brokerAccountId: account.id, statementDate: input.statementDate, fingerprint,
          sourcePageCount: input.sourcePageCount,
          genericAsOf: true, manuallyConfirmed: true,
          allRelevantPagesReviewed: input.allRelevantPagesReviewed, fingerprintVersion: 2,
          depositCount: input.deposits.rows.length,
          collateralCount: input.collateral.rows.length,
          domesticStockLotCount: input.domesticStockLots.rows.length,
          fundBalanceCount: input.fundBalances.rows.length,
          marginCount: input.margin.rows.length,
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
            quantity: row.quantity, market: row.market, side: row.side,
            contractDate: row.contractDate, contractUnitPrice: row.contractUnitPrice,
            currentPrice: row.currentPrice, fees: row.fees, unrealizedPnl: row.unrealizedPnl,
            finalRepaymentDueDate: row.finalRepaymentDueDate,
            settlementContractDate: row.settlementContractDate,
          })));
        }
        return { created: true as const, checkpoint: summary(inserted as never) };
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
