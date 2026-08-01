import { describe, expect, it } from 'vitest';
import { summarizeAssetEvidence, type AssetEvidence } from '@/asset-summary/domain';

const evidence: AssetEvidence = {
  checkpointId: '00000000-0000-4000-8000-000000000010',
  brokerAccountId: '00000000-0000-4000-8000-000000000001',
  accountName: 'Synthetic Account',
  statementDate: '2026-06-30',
  sections: {
    deposits: 'reported', collateral: 'reported', domesticStockLots: 'reported',
    fundBalances: 'reported', margin: 'reported', futures: 'explicit_zero', options: 'explicit_zero',
  },
  deposits: [
    { kind: 'cash_deposit' as const, amount: '100.10', sourcePage: 1, sourceRow: 1 },
    { kind: 'cash_deposit' as const, amount: '200.20', sourcePage: 1, sourceRow: 2 },
  ],
  collateral: [
    { kind: 'margin_guarantee' as const, amount: '50.00', sourcePage: 1, sourceRow: 3 },
  ],
  domesticStockLots: [
    { securityCode: '7203', securityName: 'Synthetic Motor', quantity: '10.000000', evaluationAmount: '25000.00', sourcePage: 2, sourceRow: 1 },
    { securityCode: '9432', securityName: 'Synthetic Telecom', quantity: '20.000000', evaluationAmount: null, sourcePage: 2, sourceRow: 2 },
  ],
  fundBalances: [
    { securityCode: '013.12', securityName: 'Synthetic Fund', units: '1000.000000', evaluationAmount: '12345.67', sourcePage: 3, sourceRow: 1 },
  ],
  margin: [
    { state: 'open' as const, side: 'buy' as const, securityCode: '9984', securityName: 'Synthetic Margin', quantity: '5.000000', unrealizedPnl: '-100.25', sourcePage: 4, sourceRow: 1 },
    { state: 'open' as const, side: 'sell' as const, securityCode: '6758', securityName: 'Synthetic Short', quantity: '2.000000', unrealizedPnl: null, sourcePage: 4, sourceRow: 2 },
    { state: 'settled' as const, side: 'buy' as const, securityCode: '8306', securityName: 'Synthetic Settled', quantity: '1.000000', unrealizedPnl: null, sourcePage: 4, sourceRow: 3 },
  ],
};

describe('asset evidence summary', () => {
  it('reports counts without adding source amounts or inventing a currency', () => {
    const summary = summarizeAssetEvidence(evidence);
    expect(summary.deposits).toEqual({ rowCount: 2 });
    expect(summary.collateral).toEqual({ rowCount: 1 });
    expect(summary.funds).toEqual({ rowCount: 1, evaluationReportedCount: 1 });
    expect(summary).not.toHaveProperty('totalAssets');
    expect(JSON.stringify(summary)).not.toMatch(/reportedTotal|evaluationTotal|300\.30|12345\.67/);
  });

  it('fails closed when even one stock evaluation amount is absent', () => {
    expect(summarizeAssetEvidence(evidence).stocks).toEqual({
      rowCount: 2,
      evaluation: { state: 'incomplete', reportedCount: 1, missingCount: 1 },
    });
  });

  it('reports margin evidence separately and excludes settled rows from open exposure', () => {
    expect(summarizeAssetEvidence(evidence).margin).toEqual({
      rowCount: 3,
      openCount: 2,
      settledCount: 1,
      openUnrealizedPnl: { state: 'incomplete', reportedCount: 1, missingCount: 1 },
    });
  });
});
