import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import type { SessionStore } from '@/auth/session';
import {
  createFullBalanceReportCheckpointHandlers,
  MAX_FULL_BALANCE_REPORT_CHECKPOINT_BYTES,
} from '@/import/sbi/full-balance-report-checkpoint-http';
import { FullBalanceReportCheckpointRepositoryError } from '@/import/sbi/full-balance-report-checkpoint-repository';

const payload = {
  brokerAccountId: '11111111-1111-4111-8111-111111111111',
  statementDate: '2026-06-15', sourcePageCount: 1, allRelevantPagesReviewed: true,
  evidence: { kind: 'generic_as_of', confirmation: 'manual' },
  deposits: { evidenceState: 'explicit_zero', zeroLocator: { sourcePage: 1, sourceRow: 1 }, rows: [] },
  collateral: { evidenceState: 'explicit_zero', zeroLocator: { sourcePage: 1, sourceRow: 2 }, rows: [] },
  domesticStockLots: { evidenceState: 'explicit_zero', zeroLocator: { sourcePage: 1, sourceRow: 3 }, rows: [] },
  fundBalances: { evidenceState: 'explicit_zero', zeroLocator: { sourcePage: 1, sourceRow: 4 }, rows: [] },
  margin: { evidenceState: 'explicit_zero', zeroLocator: { sourcePage: 1, sourceRow: 5 }, rows: [] },
  futures: { evidenceState: 'explicit_zero', zeroLocator: { sourcePage: 1, sourceRow: 6 }, rows: [] },
  options: { evidenceState: 'explicit_zero', zeroLocator: { sourcePage: 1, sourceRow: 7 }, rows: [] },
};

function request(body: unknown = payload, options: { origin?: string; type?: string; raw?: BodyInit; length?: string } = {}) {
  return new NextRequest('https://portfolio.example/api/imports/sbi/full-balance-report-checkpoints', {
    method: 'POST',
    headers: {
      origin: options.origin ?? 'https://portfolio.example',
      cookie: 'portfolio_session=synthetic-token',
      'content-type': options.type ?? 'application/json',
      ...(options.length ? { 'content-length': options.length } : {}),
    },
    body: options.raw ?? JSON.stringify(body),
  });
}

function setup() {
  const sessionStore: SessionStore = {
    findActiveUserByTokenHash: vi.fn().mockResolvedValue('synthetic-owner'),
  };
  const repository = {
    save: vi.fn().mockResolvedValue({
      created: true,
      checkpoint: { id: '22222222-2222-4222-8222-222222222222', statementDate: '2026-06-15', rowCount: 0 },
    }),
  };
  return {
    repository,
    handler: createFullBalanceReportCheckpointHandlers({
      expectedOrigin: 'https://portfolio.example', sessionStore, repository,
    }),
  };
}

describe('full balance report checkpoint API v2', () => {
  it('accepts only the exact authenticated same-origin JSON boundary and returns a minimal DTO', async () => {
    const { handler, repository } = setup();
    const response = await handler.POST(request());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ checkpoint: {
      id: '22222222-2222-4222-8222-222222222222', statementDate: '2026-06-15', rowCount: 0,
    } });
    expect(repository.save.mock.calls[0][1]).toEqual(payload);
  });

  it.each([
    ['owner', { ...payload, ownerUserId: 'attacker' }],
    ['PDF bytes', { ...payload, pdfBytes: [37, 80, 68, 70] }],
    ['OCR', { ...payload, ocrText: 'synthetic OCR' }],
    ['report', { ...payload, report: {} }],
    ['filename', { ...payload, filename: 'synthetic.pdf' }],
  ])('rejects persistence-boundary data: %s', async (_label, value) => {
    const { handler, repository } = setup();
    const response = await handler.POST(request(value));
    expect(response.status).toBe(400);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it.each([
    ['wrong origin', { origin: 'https://evil.example' }, 403],
    ['wrong media type', { type: 'text/plain' }, 415],
    ['oversized declaration', { length: String(MAX_FULL_BALANCE_REPORT_CHECKPOINT_BYTES + 1) }, 413],
    ['oversized stream', { raw: ' '.repeat(MAX_FULL_BALANCE_REPORT_CHECKPOINT_BYTES + 1) }, 413],
  ])('fails closed for %s', async (_label, options, status) => {
    const { handler, repository } = setup();
    expect((await handler.POST(request(payload, options))).status).toBe(status);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('keeps a validator-valid maximum-row payload within the bounded UTF-8 cap', async () => {
    let locatorIndex = 0;
    const located = () => {
      const index = locatorIndex++;
      return { sourcePage: Math.floor(index / 100) + 1, sourceRow: index % 100 + 1 };
    };
    const rows = <T,>(make: (index: number) => T) =>
      Array.from({ length: 100 }, (_, index) => ({ ...make(index), ...located() }));
    const name = '😀'.repeat(100);
    const maximum = {
      ...payload,
      sourcePageCount: 6,
      deposits: { evidenceState: 'reported', zeroLocator: null,
        rows: rows(() => ({ kind: 'cash_deposit', amount: '999999999999999999.99' })) },
      collateral: { evidenceState: 'reported', zeroLocator: null,
        rows: rows(() => ({ kind: 'margin_guarantee', amount: '999999999999999999.99' })) },
      domesticStockLots: { evidenceState: 'reported', zeroLocator: null, rows: rows((index) => ({
        rowKind: 'acquisition_lot', securityCode: `${1000 + index}`, securityName: name,
        acquisitionDate: '2026-06-15', quantity: '999999999999999999.999999',
        acquisitionUnitPriceState: 'reported', acquisitionUnitPrice: '999999999999999999.999999',
        purchaseAmountState: 'reported', purchaseAmount: '999999999999999999.99',
        referencePrice: '999999999999999999.999999', evaluationAmount: '999999999999999999.99',
      })) },
      fundBalances: { evidenceState: 'reported', zeroLocator: null, rows: rows((index) => ({
        securityCode: `${2000 + index}`, securityName: name, units: '999999999999999999.999999',
        referencePrice: '999999999999999999.999999', evaluationAmount: '999999999999999999.99',
        referencePriceUnit: '999999999999999999.999999',
      })) },
      margin: { evidenceState: 'reported', zeroLocator: null, rows: rows((index) => ({
        state: 'open', securityCode: `${3000 + index}`, securityName: name,
        repaymentTermLabel: 'x'.repeat(50), designationLabel: 'x'.repeat(50),
        quantity: '999999999999999999.999999', market: 'sapporo', side: 'sell',
        contractDate: '2026-06-15', contractUnitPrice: '999999999999999999.999999',
        currentPrice: '999999999999999999.999999', fees: '999999999999999999.99',
        unrealizedPnl: '-999999999999999999.99', finalSettlementOrPlannedDate: '9999-12-31',
      })) },
      futures: { evidenceState: 'explicit_zero', zeroLocator: located(), rows: [] },
      options: { evidenceState: 'explicit_zero', zeroLocator: located(), rows: [] },
    };
    const json = JSON.stringify(maximum);
    expect(new TextEncoder().encode(json).byteLength)
      .toBeLessThanOrEqual(MAX_FULL_BALANCE_REPORT_CHECKPOINT_BYTES);
    const { handler, repository } = setup();
    expect((await handler.POST(request(maximum))).status).toBe(201);
    expect(repository.save).toHaveBeenCalledOnce();
  });

  it('maps typed account failures and hides all other internal errors', async () => {
    const { handler, repository } = setup();
    repository.save.mockRejectedValueOnce(new FullBalanceReportCheckpointRepositoryError('invalid_account'));
    expect((await handler.POST(request())).status).toBe(404);
    repository.save.mockRejectedValueOnce(new Error('sensitive internal detail'));
    const response = await handler.POST(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('sensitive internal detail');
  });
});
