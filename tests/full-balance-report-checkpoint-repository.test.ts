import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import { resolveSessionPrincipal } from '@/auth/session';
import type { AppDatabase } from '@/db/client';
import { validateFullBalanceReportCheckpoint } from '@/import/sbi/full-balance-report-checkpoint';
import { createFullBalanceReportCheckpointRepository } from '@/import/sbi/full-balance-report-checkpoint-repository';
import { applyAllMigrations } from './helpers/migrations';

const checkpoint = validateFullBalanceReportCheckpoint({
  brokerAccountId: '00000000-0000-4000-8000-000000000001',
  statementDate: '2026-06-15',
  sourcePageCount: 1,
  allRelevantPagesReviewed: true,
  evidence: { kind: 'generic_as_of', confirmation: 'manual' },
  deposits: { evidenceState: 'reported', zeroLocator: null, rows: [{ kind: 'cash_deposit', amount: '100', sourcePage: 1, sourceRow: 1 }] },
  collateral: { evidenceState: 'explicit_zero', zeroLocator: { sourcePage: 1, sourceRow: 2 }, rows: [] },
  domesticStockLots: { evidenceState: 'explicit_zero', zeroLocator: { sourcePage: 1, sourceRow: 3 }, rows: [] },
  fundBalances: { evidenceState: 'explicit_zero', zeroLocator: { sourcePage: 1, sourceRow: 4 }, rows: [] },
  margin: { evidenceState: 'explicit_zero', zeroLocator: { sourcePage: 1, sourceRow: 5 }, rows: [] },
  futures: { evidenceState: 'explicit_zero', zeroLocator: { sourcePage: 1, sourceRow: 6 }, rows: [] },
  options: { evidenceState: 'explicit_zero', zeroLocator: { sourcePage: 1, sourceRow: 7 }, rows: [] },
});

async function setup() {
  const client = new PGlite();
  await applyAllMigrations(client);
  await client.exec(`
    insert into "user" (id, name) values ('synthetic-owner-a', 'A'), ('synthetic-owner-b', 'B');
    insert into broker_accounts (id, owner_user_id, broker, display_name) values
      ('00000000-0000-4000-8000-000000000001', 'synthetic-owner-a', 'sbi', 'Synthetic A'),
      ('00000000-0000-4000-8000-000000000002', 'synthetic-owner-b', 'sbi', 'Synthetic B');
  `);
  const principal = (await resolveSessionPrincipal('synthetic-token', {
    findActiveUserByTokenHash: async () => 'synthetic-owner-a',
  }))!;
  return {
    client,
    principal,
    repository: createFullBalanceReportCheckpointRepository(
      drizzle({ client }) as unknown as AppDatabase,
    ),
  };
}

describe('full balance report checkpoint repository', () => {
  it('persists source page count and independent stock value evidence states explicitly', async () => {
    const context = await setup();
    const stockCheckpoint = validateFullBalanceReportCheckpoint({
      ...checkpoint,
      sourcePageCount: 2,
      deposits: { evidenceState: 'explicit_zero', zeroLocator: { sourcePage: 1, sourceRow: 1 }, rows: [] },
      domesticStockLots: {
        evidenceState: 'reported',
        zeroLocator: null,
        rows: [{
          rowKind: 'acquisition_lot',
          securityCode: '7203',
          securityName: 'Synthetic Motor',
          acquisitionDate: '2026-06-01',
          quantity: '10',
          acquisitionUnitPriceState: 'masked',
          acquisitionUnitPrice: null,
          purchaseAmountState: 'reported',
          purchaseAmount: '25000',
          referencePrice: '2600',
          evaluationAmount: '26000',
          sourcePage: 2,
          sourceRow: 1,
        }],
      },
    });
    try {
      const first = await context.repository.save(context.principal, stockCheckpoint);
      const replay = await context.repository.save(context.principal, stockCheckpoint);
      expect(replay).toEqual({ created: false, checkpoint: first.checkpoint });
      const parent = await context.client.query<{ source_page_count: number }>(
        'select source_page_count from full_balance_report_checkpoints',
      );
      expect(parent.rows).toEqual([{ source_page_count: 2 }]);
      const rows = await context.client.query<{
        acquisition_unit_price_state: string;
        purchase_amount_state: string;
        acquisition_unit_price: string | null;
        purchase_amount: string | null;
      }>(`select acquisition_unit_price_state, purchase_amount_state,
                 acquisition_unit_price, purchase_amount
          from full_balance_report_stock_lots`);
      expect(rows.rows).toEqual([{
        acquisition_unit_price_state: 'masked',
        purchase_amount_state: 'reported',
        acquisition_unit_price: null,
        purchase_amount: '25000.00',
      }]);
    } finally {
      await context.client.close();
    }
  });

  it('atomically saves normalized children and exactly replays without duplicates', async () => {
    const context = await setup();
    try {
      const first = await context.repository.save(context.principal, checkpoint);
      const replay = await context.repository.save(context.principal, checkpoint);
      expect(first).toMatchObject({ created: true, checkpoint: { rowCount: 1 } });
      expect(replay).toMatchObject({ created: false, checkpoint: first.checkpoint });
      const counts = await context.client.query<{ parents: number; cash: number }>(`
        select
          (select count(*)::int from full_balance_report_checkpoints) parents,
          (select count(*)::int from full_balance_report_cash_rows) cash
      `);
      expect(counts.rows[0]).toEqual({ parents: 1, cash: 1 });
    } finally {
      await context.client.close();
    }
  });

  it('fails closed for a broker account owned by another user', async () => {
    const context = await setup();
    try {
      await expect(context.repository.save(context.principal, {
        ...checkpoint,
        brokerAccountId: '00000000-0000-4000-8000-000000000002',
      })).rejects.toMatchObject({ code: 'invalid_account' });
    } finally {
      await context.client.close();
    }
  });

  it('lists a minimal owner-scoped summary with no account or timestamp', async () => {
    const context = await setup();
    try {
      await context.repository.save(context.principal, checkpoint);
      const recent = await context.repository.listRecent(context.principal);
      expect(recent).toEqual([expect.objectContaining({
        statementDate: '2026-06-15', rowCount: 1,
      })]);
      expect(recent[0]).not.toHaveProperty('brokerAccountId');
      expect(recent[0]).not.toHaveProperty('ownerUserId');
      expect(recent[0]).not.toHaveProperty('createdAt');
    } finally {
      await context.client.close();
    }
  });
});
