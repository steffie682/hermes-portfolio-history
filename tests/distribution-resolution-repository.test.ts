import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import { resolveSessionPrincipal } from '@/auth/session';
import type { AppDatabase } from '@/db/client';
import { createImportRepository } from '@/import/repository';
import { parseDistributionReinvestmentDetails } from '@/import/sbi/distribution-reinvestment-details';
import { createMemoryPrivateSourceStorage } from '@/import/storage/memory-private-source-storage';
import { applyAllMigrations } from './helpers/migrations';

const HEADER = '約定日,銘柄,銘柄コード,市場,取引,期限,預り,課税,約定数量,約定単価,手数料/諸経費等,税額,受渡日,受渡金額/決済損益';
const ROW = '2026/07/10,合成投資信託,9999,--,分配金再投資,--,特定,申告,12.34,10500,--,--,2026/07/11,--';
const READY_ROW = '2026/07/01,合成銘柄,0000,東証,株式現物買,--,特定,申告,10,1000,--,--,2026/07/03,10000';
const details = parseDistributionReinvestmentDetails({
  sourceRowNumber: 2,
  distributionType: 'ordinary-distribution',
  reinvestmentDate: '2026-07-11',
  individualPrincipalPerTenThousand: '10000.5',
  reinvestmentAmountYen: '1234',
  navPerTenThousand: '10500',
  reinvestmentQuantity: '12.34',
  postReinvestmentBalance: '112.34',
});

async function setup() {
  const client = new PGlite();
  await applyAllMigrations(client);
  await client.exec(`
    insert into "user" (id, name) values ('user-a', 'User A'), ('user-b', 'User B');
    insert into broker_accounts (id, owner_user_id, broker, display_name) values
      ('00000000-0000-4000-8000-000000000001', 'user-a', 'sbi', 'SBI A'),
      ('00000000-0000-4000-8000-000000000002', 'user-b', 'sbi', 'SBI B');
  `);
  const principal = (await resolveSessionPrincipal('a', {
    findActiveUserByTokenHash: async () => 'user-a',
  }))!;
  const other = (await resolveSessionPrincipal('b', {
    findActiveUserByTokenHash: async () => 'user-b',
  }))!;
  const repository = createImportRepository(
    drizzle({ client }) as unknown as AppDatabase,
    createMemoryPrivateSourceStorage(),
  );
  const staged = await repository.stageSbiTradeHistory({
    principal,
    brokerAccountId: '00000000-0000-4000-8000-000000000001',
    mediaType: 'text/csv',
    bytes: new TextEncoder().encode(`${HEADER}\n${ROW}`),
  });
  return { client, repository, principal, other, batchId: staged.batchId };
}

describe('distribution detail repository resolution', () => {
  it('blocks commit without mutating the batch or ledger until distribution details are resolved', async () => {
    const context = await setup();
    try {
      const mixed = await context.repository.stageSbiTradeHistory({
        principal: context.principal,
        brokerAccountId: '00000000-0000-4000-8000-000000000001',
        mediaType: 'text/csv',
        bytes: new TextEncoder().encode(`${HEADER}\n${READY_ROW}\n${ROW}`),
      });
      await expect(context.repository.commitBatch({
        principal: context.principal,
        batchId: mixed.batchId,
      })).rejects.toMatchObject({ code: 'distribution_details_required' });

      await expect(context.client.query<{
        status: string;
        committed_at: Date | null;
        ledger_count: number;
      }>(`
        select status, committed_at,
          (select count(*)::int from ledger_events) as ledger_count
        from import_batches
        where id = '${mixed.batchId}'
      `)).resolves.toMatchObject({
        rows: [{
          status: 'preview_ready',
          committed_at: null,
          ledger_count: 0,
        }],
      });
    } finally {
      await context.client.close();
    }
  });

  it('resolves an exact match atomically and returns the result idempotently', async () => {
    const context = await setup();
    try {
      await expect(context.repository.resolveDistributionDetails({
        principal: context.principal,
        batchId: context.batchId,
        details,
      })).resolves.toEqual({ batchId: context.batchId, sourceRowNumber: 2, status: 'new' });
      await expect(context.repository.resolveDistributionDetails({
        principal: context.principal,
        batchId: context.batchId,
        details,
      })).resolves.toEqual({ batchId: context.batchId, sourceRowNumber: 2, status: 'new' });

      const trace = await context.repository.getBatchTrace({
        principal: context.principal,
        batchId: context.batchId,
      });
      expect(trace?.rows[0]).toMatchObject({
        status: 'new',
        reasonCode: null,
        eventKind: 'fund-distribution-reinvestment',
        payload: {
          instrument: { securityName: '合成投資信託' },
          quantityIncrease: '12.34',
          sourceQuotedUnitPrice: {
            value: '10500',
            basis: 'per-ten-thousand-units-confirmed-by-notice',
          },
          reinvestmentDetails: {
            distributionType: 'ordinary-distribution',
            provenance: 'manual-transcription',
          },
          cashTreatment: 'net-distribution-reinvested',
          taxTreatment: 'gross-distribution-and-withholding-unresolved',
          costBasisTreatment: 'recorded-reinvestment-amount-added-existing-principal-not-reduced',
        },
      });
    } finally {
      await context.client.close();
    }
  });

  it.each([
    ['date', { reinvestmentDate: '2026-07-12' }],
    ['quantity', { reinvestmentQuantity: '12.35' }],
    ['NAV', { navPerTenThousand: '10501' }],
  ])('fails closed without mutation for a %s mismatch', async (_name, change) => {
    const context = await setup();
    try {
      await expect(context.repository.resolveDistributionDetails({
        principal: context.principal,
        batchId: context.batchId,
        details: { ...details, ...change },
      })).rejects.toMatchObject({ code: 'detail_mismatch' });
      const trace = await context.repository.getBatchTrace({
        principal: context.principal,
        batchId: context.batchId,
      });
      expect(trace?.rows[0]).toMatchObject({
        status: 'needs_review',
        reasonCode: 'needs-distribution-details',
        eventKind: null,
      });
    } finally {
      await context.client.close();
    }
  });

  it('enforces owner, batch state, and conflicting retry boundaries', async () => {
    const context = await setup();
    try {
      await expect(context.repository.resolveDistributionDetails({
        principal: context.other,
        batchId: context.batchId,
        details,
      })).rejects.toMatchObject({ code: 'invalid_import' });
      await context.repository.resolveDistributionDetails({
        principal: context.principal,
        batchId: context.batchId,
        details,
      });
      await expect(context.repository.resolveDistributionDetails({
        principal: context.principal,
        batchId: context.batchId,
        details: { ...details, reinvestmentAmountYen: '1235' },
      })).rejects.toMatchObject({ code: 'already_resolved' });
      await context.repository.commitBatch({
        principal: context.principal,
        batchId: context.batchId,
      });
      await expect(context.repository.resolveDistributionDetails({
        principal: context.principal,
        batchId: context.batchId,
        details,
      })).rejects.toMatchObject({ code: 'already_resolved' });
    } finally {
      await context.client.close();
    }
  });

  it('classifies a same-batch economic fingerprint collision as duplicate', async () => {
    const context = await setup();
    try {
      const second = await context.repository.stageSbiTradeHistory({
        principal: context.principal,
        brokerAccountId: '00000000-0000-4000-8000-000000000001',
        mediaType: 'text/csv',
        bytes: new TextEncoder().encode(`${HEADER}\n${ROW}\n${ROW}`),
      });
      await expect(context.repository.resolveDistributionDetails({
        principal: context.principal,
        batchId: second.batchId,
        details,
      })).resolves.toMatchObject({ status: 'new' });
      await expect(context.repository.resolveDistributionDetails({
        principal: context.principal,
        batchId: second.batchId,
        details: { ...details, sourceRowNumber: 3 },
      })).resolves.toMatchObject({ status: 'duplicate' });
    } finally {
      await context.client.close();
    }
  });

  it('classifies an existing owner ledger fingerprint collision as duplicate', async () => {
    const context = await setup();
    try {
      await context.repository.resolveDistributionDetails({
        principal: context.principal,
        batchId: context.batchId,
        details,
      });
      await context.repository.commitBatch({
        principal: context.principal,
        batchId: context.batchId,
      });
      const later = await context.repository.stageSbiTradeHistory({
        principal: context.principal,
        brokerAccountId: '00000000-0000-4000-8000-000000000001',
        mediaType: 'text/csv',
        bytes: new TextEncoder().encode(`synthetic metadata\n${HEADER}\n${ROW}`),
      });
      await expect(context.repository.resolveDistributionDetails({
        principal: context.principal,
        batchId: later.batchId,
        details: { ...details, sourceRowNumber: 3 },
      })).resolves.toMatchObject({ status: 'duplicate' });
    } finally {
      await context.client.close();
    }
  });
});
