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
      expect(first).toMatchObject({ created: true, checkpoint: { rowCount: 1, unresolvedSectionCount: 0 } });
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

  it('persists unresolved margin evidence without zero or row entries and reads it back as missing', async () => {
    const context = await setup();
    const unresolved = validateFullBalanceReportCheckpoint({
      ...checkpoint,
      margin: { evidenceState: 'missing', zeroLocator: null, rows: [] },
    });
    try {
      const unresolvedSaved = await context.repository.save(context.principal, unresolved);
      expect(unresolvedSaved.checkpoint).toMatchObject({ rowCount: 1, unresolvedSectionCount: 1 });
      const sections = await context.client.query<{ evidence_state: string; declared_count: number }>(`
        select evidence_state, declared_count from full_balance_report_sections where section_kind = 'margin'
      `);
      const entries = await context.client.query<{ count: number }>(`
        select count(*)::int count from full_balance_report_entries where section_kind = 'margin'
      `);
      expect(sections.rows).toEqual([{ evidence_state: 'missing', declared_count: 0 }]);
      expect(entries.rows).toEqual([{ count: 0 }]);
      const latest = await context.repository.listLatestEvidence(context.principal);
      expect(latest[0].sections.margin).toBe('missing');
      expect(latest[0].margin).toEqual([]);
      for (const [entryKind, rowIndex, sourceRow] of [['zero', 'null', 88], ['row', '1', 89]] as const) {
        await context.client.exec('begin;');
        await context.client.exec(`
          insert into full_balance_report_entries (
            owner_user_id, broker_account_id, checkpoint_id, section_kind,
            entry_kind, row_index, source_page, source_row
          ) values (
            'synthetic-owner-a', '00000000-0000-4000-8000-000000000001',
            '${latest[0].checkpointId}', 'margin', '${entryKind}', ${rowIndex}, 1, ${sourceRow}
          );
        `);
        await expect(context.client.exec('set constraints all immediate;')).rejects.toThrow(
          'incomplete section evidence',
        );
        await context.client.exec('rollback;');
      }
    } finally {
      await context.client.close();
    }
  });

  it('rejects direct-SQL missing evidence for unsupported futures and options', async () => {
    const context = await setup();
    try {
      const saved = await context.repository.save(context.principal, checkpoint);
      for (const sectionKind of ['futures', 'options']) {
        await context.client.exec(`
          begin;
          alter table full_balance_report_entries disable trigger user;
          alter table full_balance_report_sections disable trigger user;
          delete from full_balance_report_entries
           where checkpoint_id = '${saved.checkpoint.id}' and section_kind = '${sectionKind}';
          delete from full_balance_report_sections
           where checkpoint_id = '${saved.checkpoint.id}' and section_kind = '${sectionKind}';
          alter table full_balance_report_entries enable trigger user;
          alter table full_balance_report_sections enable trigger user;
        `);
        await expect(context.client.exec(`
          insert into full_balance_report_sections (
            owner_user_id, broker_account_id, checkpoint_id, section_kind, evidence_state, declared_count
          ) values (
            'synthetic-owner-a', '00000000-0000-4000-8000-000000000001',
            '${saved.checkpoint.id}', '${sectionKind}', 'missing', 0
          );
        `)).rejects.toMatchObject({
          code: '23514',
          constraint: 'full_balance_report_sections_state_check',
        });
        await context.client.exec('rollback;');
      }
    } finally {
      await context.client.close();
    }
  });

  it('persists the exact settled margin state, source contract fields, and final date', async () => {
    const context = await setup();
    const marginCheckpoint = validateFullBalanceReportCheckpoint({
      ...checkpoint,
      deposits: { evidenceState: 'explicit_zero', zeroLocator: { sourcePage: 1, sourceRow: 1 }, rows: [] },
      margin: {
        evidenceState: 'reported',
        zeroLocator: null,
        rows: [{
          state: 'settled',
          securityCode: '3579',
          securityName: 'Synthetic Margin',
          repaymentTermLabel: 'Synthetic Term',
          designationLabel: 'Synthetic Designation',
          quantity: '6',
          market: 'tokyo',
          side: 'buy',
          contractDate: '2026-06-01',
          contractUnitPrice: '220',
          currentPrice: null,
          fees: null,
          unrealizedPnl: null,
          finalSettlementOrPlannedDate: '2026-06-16',
          sourcePage: 1,
          sourceRow: 5,
        }],
      },
    });
    try {
      await context.repository.save(context.principal, marginCheckpoint);
      const rows = await context.client.query<{
        state: string; repayment_term_label: string; designation_label: string;
        contract_date: string; contract_unit_price: string; final_settlement_or_planned_date: string;
      }>(`select state, repayment_term_label, designation_label,
                 contract_date::text contract_date, contract_unit_price,
                 final_settlement_or_planned_date::text final_settlement_or_planned_date
          from full_balance_report_margin_rows`);
      expect(rows.rows).toEqual([{
        state: 'settled',
        repayment_term_label: 'Synthetic Term',
        designation_label: 'Synthetic Designation',
        contract_date: '2026-06-01',
        contract_unit_price: '220.000000',
        final_settlement_or_planned_date: '2026-06-16',
      }]);
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

  it('reads the latest normalized evidence with source locators for the principal only', async () => {
    const context = await setup();
    const richCheckpoint = validateFullBalanceReportCheckpoint({
      ...checkpoint,
      sourcePageCount: 4,
      domesticStockLots: {
        evidenceState: 'reported', zeroLocator: null, rows: [{
          rowKind: 'acquisition_lot', securityCode: '7203', securityName: 'Synthetic Motor',
          acquisitionDate: '2026-06-01', quantity: '10',
          acquisitionUnitPriceState: 'reported', acquisitionUnitPrice: '2500',
          purchaseAmountState: 'reported', purchaseAmount: '25000',
          referencePrice: '2600', evaluationAmount: '26000', sourcePage: 2, sourceRow: 1,
        }],
      },
      fundBalances: {
        evidenceState: 'reported', zeroLocator: null, rows: [{
          securityCode: '013.12', securityName: 'Synthetic Fund', units: '1000',
          referencePrice: '12345', evaluationAmount: '12345', referencePriceUnit: '10000',
          sourcePage: 3, sourceRow: 1,
        }],
      },
      margin: {
        evidenceState: 'reported', zeroLocator: null, rows: [{
          state: 'open', securityCode: '9984', securityName: 'Synthetic Margin',
          repaymentTermLabel: 'Synthetic Term', designationLabel: null, quantity: '5',
          market: 'tokyo', side: 'buy', contractDate: '2026-06-01',
          contractUnitPrice: '1000', currentPrice: '1100', fees: '10', unrealizedPnl: '490',
          finalSettlementOrPlannedDate: '2026-12-01', sourcePage: 4, sourceRow: 1,
        }],
      },
    });
    try {
      const otherPrincipal = (await resolveSessionPrincipal('synthetic-token-b', {
        findActiveUserByTokenHash: async () => 'synthetic-owner-b',
      }))!;
      await context.repository.save(otherPrincipal, validateFullBalanceReportCheckpoint({
        ...checkpoint,
        brokerAccountId: '00000000-0000-4000-8000-000000000002',
        deposits: { evidenceState: 'reported', zeroLocator: null, rows: [{
          kind: 'cash_deposit', amount: '999999', sourcePage: 1, sourceRow: 1,
        }] },
      }));
      const saved = await context.repository.save(context.principal, richCheckpoint);
      const latest = await context.repository.listLatestEvidence(context.principal);

      expect(latest).toEqual([{
        checkpointId: saved.checkpoint.id,
        brokerAccountId: '00000000-0000-4000-8000-000000000001',
        accountName: 'Synthetic A',
        statementDate: '2026-06-15',
        sections: {
          deposits: 'reported', collateral: 'explicit_zero', domesticStockLots: 'reported',
          fundBalances: 'reported', margin: 'reported', futures: 'explicit_zero', options: 'explicit_zero',
        },
        deposits: [{ kind: 'cash_deposit', amount: '100.00', sourcePage: 1, sourceRow: 1 }],
        collateral: [],
        domesticStockLots: [{
          securityCode: '7203', securityName: 'Synthetic Motor', quantity: '10.000000',
          evaluationAmount: '26000.00', sourcePage: 2, sourceRow: 1,
        }],
        fundBalances: [{
          securityCode: '013.12', securityName: 'Synthetic Fund', units: '1000.000000',
          evaluationAmount: '12345.00', sourcePage: 3, sourceRow: 1,
        }],
        margin: [{
          state: 'open', side: 'buy', securityCode: '9984', securityName: 'Synthetic Margin',
          quantity: '5.000000', unrealizedPnl: '490.00', sourcePage: 4, sourceRow: 1,
        }],
      }]);
      expect(latest[0]).not.toHaveProperty('ownerUserId');
    } finally {
      await context.client.close();
    }
  });

  it('selects the newest checkpoint when the statement date is the same', async () => {
    const context = await setup();
    try {
      await context.repository.save(context.principal, checkpoint);
      await context.repository.save(context.principal, validateFullBalanceReportCheckpoint({
        ...checkpoint,
        deposits: { evidenceState: 'reported', zeroLocator: null, rows: [{
          kind: 'cash_deposit', amount: '200', sourcePage: 1, sourceRow: 1,
        }] },
      }));
      const latest = await context.repository.listLatestEvidence(context.principal);
      expect(latest).toHaveLength(1);
      expect(latest[0].deposits).toEqual([
        { kind: 'cash_deposit', amount: '200.00', sourcePage: 1, sourceRow: 1 },
      ]);
    } finally {
      await context.client.close();
    }
  });

  it('limits after selecting evidence-bearing accounts and normalizes invalid limits', async () => {
    const context = await setup();
    const targetAccountId = '00000000-0000-4000-8000-000000000019';
    try {
      const oldAccounts = Array.from({ length: 9 }, (_, index) => {
        const suffix = String(index + 10).padStart(12, '0');
        return `('00000000-0000-4000-8000-${suffix}', 'synthetic-owner-a', 'sbi', 'Old ${index + 1}', '2020-01-01')`;
      }).join(',');
      await context.client.exec(`
        insert into broker_accounts (id, owner_user_id, broker, display_name, created_at) values
          ${oldAccounts},
          ('${targetAccountId}', 'synthetic-owner-a', 'sbi', 'Evidence Account', '2027-01-01');
      `);
      await context.repository.save(context.principal, validateFullBalanceReportCheckpoint({
        ...checkpoint,
        brokerAccountId: targetAccountId,
      }));

      for (const invalidLimit of [Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
        const latest = await context.repository.listLatestEvidence(context.principal, invalidLimit);
        expect(latest).toHaveLength(1);
        expect(latest[0]).toMatchObject({
          brokerAccountId: targetAccountId,
          accountName: 'Evidence Account',
        });
      }
    } finally {
      await context.client.close();
    }
  });

  it('reports owner-scoped import readiness counts without financial values', async () => {
    const context = await setup();
    try {
      await expect(context.repository.getImportReadiness(context.principal)).resolves.toEqual({
        ledgerEventCount: 0,
        unresolvedDistributionCount: 0,
        otherNeedsReviewCount: 0,
        previewReadyBatchCount: 0,
      });
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
        statementDate: '2026-06-15', rowCount: 1, unresolvedSectionCount: 0,
      })]);
      expect(recent[0]).not.toHaveProperty('brokerAccountId');
      expect(recent[0]).not.toHaveProperty('ownerUserId');
      expect(recent[0]).not.toHaveProperty('createdAt');
    } finally {
      await context.client.close();
    }
  });
});
