import { describe, expect, it } from 'vitest';
import { assessSbiDistributionReinvestments, toSbiDistributionReinvestmentEvent } from '@/import/sbi/distribution-reinvestment-event';
import type { SbiTradeHistoryRow } from '@/import/sbi/trade-history';

function row(overrides: Partial<SbiTradeHistoryRow> = {}): SbiTradeHistoryRow {
  return {
    sourceRowNumber: 6,
    contractDate: '2026-01-05',
    securityName: 'SYNTHETIC FUND',
    securityCode: null,
    market: null,
    transactionType: '分配金再投資',
    term: '--',
    custodyType: '特定',
    taxationType: '申告',
    quantity: '42.5',
    unitPrice: '12345',
    feesOrExpenses: null,
    feesOrExpensesRaw: '--',
    taxAmount: '120',
    taxAmountRaw: '120',
    settlementDate: '2026-01-07',
    settlementAmountOrProfitLoss: '5000',
    settlementAmountOrProfitLossRaw: '5,000',
    ...overrides,
  };
}

describe('SBI distribution reinvestment staged event', () => {
  it('prepares only the fund-unit increase and keeps accounting treatments unresolved', () => {
    expect(toSbiDistributionReinvestmentEvent(row())).toEqual({
      status: 'units-ready',
      event: {
        sourceRowNumber: 6,
        assetClass: 'fund',
        operation: 'reinvestment-units',
        instrument: { securityCode: null, securityName: 'SYNTHETIC FUND' },
        contractDate: '2026-01-05',
        settlementDate: '2026-01-07',
        custodyType: '特定',
        taxationType: '申告',
        quantityIncrease: '42.5',
        sourceQuotedUnitPrice: { value: '12345', basis: 'unverified' },
        cashTreatment: 'unresolved',
        taxTreatment: 'unresolved',
        costBasisTreatment: 'unresolved',
      },
    });
  });

  it('fails closed for a non-reinvestment transaction', () => {
    expect(toSbiDistributionReinvestmentEvent(row({ transactionType: '投信金額買付' }))).toEqual({
      status: 'needs-review', sourceRowNumber: 6, reason: 'unsupported-transaction-type',
    });
  });


  it.each([
    [{ quantity: '0' }, 'invalid-quantity'],
    [{ quantity: '-1' }, 'invalid-quantity'],
    [{ unitPrice: '0' }, 'invalid-unit-price'],
    [{ unitPrice: '-1' }, 'invalid-unit-price'],
  ] as const)('fails closed for non-positive reinvestment values', (overrides, reason) => {
    expect(toSbiDistributionReinvestmentEvent(row(overrides))).toEqual({
      status: 'needs-review', sourceRowNumber: 6, reason,
    });
  });


  it('reduces reinvestments to privacy-safe unit-readiness counts', () => {
    const assessment = assessSbiDistributionReinvestments([
      row({ securityName: 'SECRET_FUND', quantity: '99999', unitPrice: '88888' }),
      row({ sourceRowNumber: 7, quantity: '0' }),
      row({ sourceRowNumber: 8, transactionType: '株式現物買' }),
    ]);
    expect(assessment).toEqual({
      candidateRows: 2,
      unitsReadyRows: 1,
      needsReviewRows: 1,
      requiresDistributionDetails: true,
    });
    const serialized = JSON.stringify(assessment);
    for (const secret of ['SECRET_FUND', '99999', '88888']) expect(serialized).not.toContain(secret);
  });

});
