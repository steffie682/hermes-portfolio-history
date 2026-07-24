import { and, desc, eq, sql } from 'drizzle-orm';
import { authenticatedPrincipalId, type AuthenticatedPrincipal } from '@/auth/session';
import type { AppDatabase } from '@/db/client';
import {
  balanceReportPositions,
  balanceReportSnapshots,
  brokerAccounts,
} from '@/db/schema';
import {
  fingerprintBalanceReportSnapshot,
  type CanonicalBalanceReportSnapshot,
} from './balance-report-snapshot';

export class BalanceReportSnapshotRepositoryError extends Error {
  constructor(readonly code: 'invalid_account') {
    super(code);
  }
}

export type PublicBalanceReportSnapshot = {
  id: string;
  statementDate: string;
  positionCount: number;
};

const internalSelection = {
  id: balanceReportSnapshots.id,
  statementDate: balanceReportSnapshots.statementDate,
  positionCount: balanceReportSnapshots.positionCount,
};

export function createBalanceReportSnapshotRepository(db: AppDatabase) {
  return {
    async save(
      principal: AuthenticatedPrincipal,
      input: CanonicalBalanceReportSnapshot,
    ) {
      const ownerUserId = authenticatedPrincipalId(principal);
      const fingerprint = fingerprintBalanceReportSnapshot(ownerUserId, input);
      return db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.current_user_id', ${ownerUserId}, true)`);
        const [account] = await tx
          .select({ id: brokerAccounts.id })
          .from(brokerAccounts)
          .where(and(
            eq(brokerAccounts.ownerUserId, ownerUserId),
            eq(brokerAccounts.id, input.brokerAccountId),
            eq(brokerAccounts.broker, 'sbi'),
          ))
          .limit(1);
        if (!account) throw new BalanceReportSnapshotRepositoryError('invalid_account');

        const [inserted] = await tx
          .insert(balanceReportSnapshots)
          .values({
            ownerUserId,
            brokerAccountId: account.id,
            statementDate: input.statementDate,
            fingerprint,
            status: 'confirmed',
            positionCount: input.positions.length,
          })
          .onConflictDoNothing({
            target: [balanceReportSnapshots.ownerUserId, balanceReportSnapshots.fingerprint],
          })
          .returning(internalSelection);

        if (!inserted) {
          const [existing] = await tx
            .select(internalSelection)
            .from(balanceReportSnapshots)
            .where(and(
              eq(balanceReportSnapshots.ownerUserId, ownerUserId),
              eq(balanceReportSnapshots.fingerprint, fingerprint),
            ))
            .limit(1);
          if (!existing) throw new Error('Snapshot replay is unavailable');
          return { created: false as const, snapshot: existing };
        }

        if (input.positions.length > 0) {
          await tx.insert(balanceReportPositions).values(input.positions.map((position, index) => ({
            ownerUserId,
            brokerAccountId: account.id,
            snapshotId: inserted.id,
            positionIndex: index + 1,
            sourcePage: position.sourcePage,
            sourceRow: position.sourceRow,
            side: position.side,
            securityCode: position.securityCode,
            securityName: position.securityName,
            quantity: position.quantity,
            unitPriceYen: position.unitPriceYen,
            openedOn: position.openedOn,
            dueOn: position.dueOn,
          })));
        }
        return { created: true as const, snapshot: inserted };
      });
    },

    async listRecent(principal: AuthenticatedPrincipal, limit = 10) {
      const ownerUserId = authenticatedPrincipalId(principal);
      return db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.current_user_id', ${ownerUserId}, true)`);
        return tx
          .select(internalSelection)
          .from(balanceReportSnapshots)
          .where(eq(balanceReportSnapshots.ownerUserId, ownerUserId))
          .orderBy(desc(balanceReportSnapshots.createdAt))
          .limit(Math.min(Math.max(limit, 1), 20));
      });
    },
  };
}
