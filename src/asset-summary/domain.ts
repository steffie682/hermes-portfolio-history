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
export type AssetEvidenceState = 'reported' | 'explicit_zero' | 'missing';

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
type UnavailableCoverage = { state: 'unavailable'; reason: 'section_missing' };

function coverage(values: Array<string | null>): ReportedCoverage {
  const reportedCount = values.filter((value) => value !== null).length;
  const missingCount = values.length - reportedCount;
  return missingCount === 0
    ? { state: 'complete', reportedCount, missingCount: 0 }
    : { state: 'incomplete', reportedCount, missingCount };
}

function sectionRowCount(state: AssetEvidenceState, count: number): number | null {
  return state === 'missing' ? null : count;
}

function sectionCoverage(
  state: AssetEvidenceState,
  values: Array<string | null>,
): ReportedCoverage | UnavailableCoverage {
  return state === 'missing'
    ? { state: 'unavailable', reason: 'section_missing' }
    : coverage(values);
}

export function summarizeAssetEvidence(evidence: AssetEvidence) {
  const openMargin = evidence.margin.filter((row) => row.state === 'open');
  const marginMissing = evidence.sections.margin === 'missing';
  return {
    deposits: {
      evidenceState: evidence.sections.deposits,
      rowCount: sectionRowCount(evidence.sections.deposits, evidence.deposits.length),
    },
    collateral: {
      evidenceState: evidence.sections.collateral,
      rowCount: sectionRowCount(evidence.sections.collateral, evidence.collateral.length),
    },
    stocks: {
      evidenceState: evidence.sections.domesticStockLots,
      rowCount: sectionRowCount(evidence.sections.domesticStockLots, evidence.domesticStockLots.length),
      evaluation: sectionCoverage(
        evidence.sections.domesticStockLots,
        evidence.domesticStockLots.map((row) => row.evaluationAmount),
      ),
    },
    funds: {
      evidenceState: evidence.sections.fundBalances,
      rowCount: sectionRowCount(evidence.sections.fundBalances, evidence.fundBalances.length),
      evaluationReportedCount: evidence.sections.fundBalances === 'missing'
        ? null
        : evidence.fundBalances.length,
    },
    margin: {
      evidenceState: evidence.sections.margin,
      rowCount: sectionRowCount(evidence.sections.margin, evidence.margin.length),
      openCount: marginMissing ? null : openMargin.length,
      settledCount: marginMissing ? null : evidence.margin.length - openMargin.length,
      openUnrealizedPnl: sectionCoverage(
        evidence.sections.margin,
        openMargin.map((row) => row.unrealizedPnl),
      ),
    },
  };
}
