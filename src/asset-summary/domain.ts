export type MoneyEvidenceRow = { amount: string; sourcePage: number; sourceRow: number };
export type StockEvidenceRow = {
  securityCode: string; securityName: string; quantity: string;
  evaluationAmount: string | null; sourcePage: number; sourceRow: number;
};
export type FundEvidenceRow = {
  securityCode: string; securityName: string; units: string;
  evaluationAmount: string; sourcePage: number; sourceRow: number;
};
export type MarginEvidenceRow = {
  state: 'open' | 'settled'; side: 'buy' | 'sell'; securityCode: string;
  securityName: string; quantity: string; unrealizedPnl: string | null;
  sourcePage: number; sourceRow: number;
};

export type AssetEvidenceSectionKind =
  | 'deposits' | 'collateral' | 'domesticStockLots' | 'fundBalances'
  | 'margin' | 'futures' | 'options';
export type AssetEvidenceState = 'reported' | 'explicit_zero';

export type AssetEvidence = {
  checkpointId: string;
  brokerAccountId: string;
  accountName: string;
  statementDate: string;
  sections: Record<AssetEvidenceSectionKind, AssetEvidenceState>;
  deposits: Array<MoneyEvidenceRow & { kind: 'cash_deposit' }>;
  collateral: Array<MoneyEvidenceRow & {
    kind: 'margin_guarantee' | 'stock_lending_collateral' | 'futures_options_margin';
  }>;
  domesticStockLots: StockEvidenceRow[];
  fundBalances: FundEvidenceRow[];
  margin: MarginEvidenceRow[];
};

type ReportedCoverage =
  | { state: 'complete'; reportedCount: number; missingCount: 0 }
  | { state: 'incomplete'; reportedCount: number; missingCount: number };

function coverage(values: Array<string | null>): ReportedCoverage {
  const reportedCount = values.filter((value) => value !== null).length;
  const missingCount = values.length - reportedCount;
  return missingCount === 0
    ? { state: 'complete', reportedCount, missingCount: 0 }
    : { state: 'incomplete', reportedCount, missingCount };
}

export function summarizeAssetEvidence(evidence: AssetEvidence) {
  const openMargin = evidence.margin.filter((row) => row.state === 'open');
  return {
    deposits: { rowCount: evidence.deposits.length },
    collateral: { rowCount: evidence.collateral.length },
    stocks: {
      rowCount: evidence.domesticStockLots.length,
      evaluation: coverage(evidence.domesticStockLots.map((row) => row.evaluationAmount)),
    },
    funds: {
      rowCount: evidence.fundBalances.length,
      evaluationReportedCount: evidence.fundBalances.length,
    },
    margin: {
      rowCount: evidence.margin.length,
      openCount: openMargin.length,
      settledCount: evidence.margin.length - openMargin.length,
      openUnrealizedPnl: coverage(openMargin.map((row) => row.unrealizedPnl)),
    },
  };
}
