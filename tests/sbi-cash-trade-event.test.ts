import { describe, expect, it } from 'vitest';
import { assessSbiCashTradeRows, toSbiCashTradeEvent } from '@/import/sbi/cash-trade-event';
import type { SbiTradeHistoryRow } from '@/import/sbi/trade-history';

function row(overrides: Partial<SbiTradeHistoryRow> = {}): SbiTradeHistoryRow {
  return {
    sourceRowNumber: 6, contractDate: '2026-01-05', securityName: 'SYNTHETIC EQUITY', securityCode: '0000',
    market: '東証', transactionType: '株式現物買', term: '--', custodyType: '特定', taxationType: '申告',
    quantity: '10', unitPrice: '1234.5', feesOrExpenses: '100', feesOrExpensesRaw: '100', taxAmount: '10',
    taxAmountRaw: '10', settlementDate: '2026-01-07', settlementAmountOrProfitLoss: '12455',
    settlementAmountOrProfitLossRaw: '12455', ...overrides,
  };
}

describe('SBI cash trade event conversion', () => {
  it('maps a cash equity purchase without recalculating SBI amounts', () => {
    expect(toSbiCashTradeEvent(row())).toEqual({
      status: 'ready',
      event: {
        sourceRowNumber: 6, assetClass: 'equity', side: 'buy', contractDate: '2026-01-05', settlementDate: '2026-01-07',
        instrument: { securityCode: '0000', securityName: 'SYNTHETIC EQUITY' }, custodyType: '特定', taxationType: '申告',
        quantity: '10', unitPrice: '1234.5', feesOrExpenses: '100', taxAmount: '10', settlementAmount: '12455',
      },
    });
  });

  it('maps a cash equity sale as a sell event', () => {
    const result = toSbiCashTradeEvent(row({ transactionType: '株式現物売', settlementAmountOrProfitLoss: '12000' }));
    expect(result).toMatchObject({ status: 'ready', event: { assetClass: 'equity', side: 'sell', settlementAmount: '12000' } });
  });

  it('maps a mutual fund amount purchase without assuming a unit-price scale', () => {
    const result = toSbiCashTradeEvent(row({ transactionType: '投信金額買付', securityCode: null, securityName: 'SYNTHETIC FUND' }));
    expect(result).toMatchObject({
      status: 'ready',
      event: {
        assetClass: 'fund', side: 'buy', instrument: { securityCode: null, securityName: 'SYNTHETIC FUND' },
        sourceQuotedUnitPrice: { value: '1234.5', basis: 'unverified' },
      },
    });
    expect(result.status === 'ready' ? result.event : null).not.toHaveProperty('unitPrice');
  });


  it('maps a mutual fund redemption as a sell event', () => {
    const result = toSbiCashTradeEvent(row({ transactionType: '投信金額解約', securityCode: null }));
    expect(result).toMatchObject({ status: 'ready', event: { assetClass: 'fund', side: 'sell' } });
  });


  it('fails closed for a transaction outside the five supported cash types', () => {
    expect(toSbiCashTradeEvent(row({ transactionType: '信用新規買' }))).toEqual({
      status: 'needs-review', sourceRowNumber: 6, reason: 'unsupported-transaction-type',
    });
  });


  it('fails closed when SBI does not provide a numeric settlement amount', () => {
    expect(toSbiCashTradeEvent(row({ settlementAmountOrProfitLoss: null, settlementAmountOrProfitLossRaw: '--' }))).toEqual({
      status: 'needs-review', sourceRowNumber: 6, reason: 'missing-settlement-amount',
    });
  });


  it('reduces cash trades to privacy-safe readiness counts', () => {
    const result = assessSbiCashTradeRows([
      row({ securityName: 'PRIVATE_A' }),
      row({ sourceRowNumber: 7, securityName: 'PRIVATE_B', transactionType: '投信金額解約', settlementAmountOrProfitLoss: null }),
      row({ sourceRowNumber: 8, securityName: 'PRIVATE_C', transactionType: '信用新規買' }),
    ]);
    expect(result).toEqual({ cashCandidateRows: 2, readyRows: 1, needsReviewRows: 1, requiresOpeningCheckpoint: true });
    const serialized = JSON.stringify(result);
    for (const secret of ['PRIVATE_A', 'PRIVATE_B', 'PRIVATE_C', '0000', '1234.5', '12455']) expect(serialized).not.toContain(secret);
  });


  it('maps a mutual fund subscription purchase as a fund buy', () => {
    const result = toSbiCashTradeEvent(row({ transactionType: '投信金額買付(募集)', securityCode: null }));
    expect(result).toMatchObject({ status: 'ready', event: { assetClass: 'fund', side: 'buy' } });
  });


  it('requires an opening checkpoint even when the two-year CSV has no cash trades', () => {
    expect(assessSbiCashTradeRows([]).requiresOpeningCheckpoint).toBe(true);
  });


  it.each(['0', '-1'])('fails closed for non-positive quantity %s', (quantity) => {
    expect(toSbiCashTradeEvent(row({ quantity }))).toEqual({
      status: 'needs-review', sourceRowNumber: 6, reason: 'invalid-quantity',
    });
  });


  it.each(['0', '-0.5'])('fails closed for non-positive source-quoted unit price %s', (unitPrice) => {
    expect(toSbiCashTradeEvent(row({ unitPrice }))).toEqual({
      status: 'needs-review', sourceRowNumber: 6, reason: 'invalid-unit-price',
    });
  });

});
