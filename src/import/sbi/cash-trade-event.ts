import type { SbiTradeHistoryRow } from './trade-history';

const CASH_TYPES = {
  '株式現物買': { assetClass: 'equity', side: 'buy' },
  '株式現物売': { assetClass: 'equity', side: 'sell' },
  '投信金額買付': { assetClass: 'fund', side: 'buy' },
  '投信金額買付(募集)': { assetClass: 'fund', side: 'buy' },
  '投信金額解約': { assetClass: 'fund', side: 'sell' },
} as const;

function isPositiveDecimal(value: string): boolean {
  return value.length <= 64 && /^\d+(?:\.\d+)?$/.test(value) && /[1-9]/.test(value);
}

export function toSbiCashTradeEvent(row: SbiTradeHistoryRow) {
  if (!Object.hasOwn(CASH_TYPES, row.transactionType)) {
    return { status: 'needs-review' as const, sourceRowNumber: row.sourceRowNumber, reason: 'unsupported-transaction-type' as const };
  }
  const mapping = CASH_TYPES[row.transactionType as keyof typeof CASH_TYPES];
  if (!isPositiveDecimal(row.quantity)) {
    return { status: 'needs-review' as const, sourceRowNumber: row.sourceRowNumber, reason: 'invalid-quantity' as const };
  }
  if (!isPositiveDecimal(row.unitPrice)) {
    return { status: 'needs-review' as const, sourceRowNumber: row.sourceRowNumber, reason: 'invalid-unit-price' as const };
  }
  if (row.settlementAmountOrProfitLoss === null) {
    return { status: 'needs-review' as const, sourceRowNumber: row.sourceRowNumber, reason: 'missing-settlement-amount' as const };
  }
  return {
    status: 'ready' as const,
    event: {
      sourceRowNumber: row.sourceRowNumber,
      assetClass: mapping.assetClass,
      side: mapping.side,
      contractDate: row.contractDate,
      settlementDate: row.settlementDate,
      instrument: { securityCode: row.securityCode, securityName: row.securityName },
      custodyType: row.custodyType,
      taxationType: row.taxationType,
      quantity: row.quantity,
      ...(mapping.assetClass === 'fund'
        ? { sourceQuotedUnitPrice: { value: row.unitPrice, basis: 'unverified' as const } }
        : { unitPrice: row.unitPrice }),
      feesOrExpenses: row.feesOrExpenses,
      taxAmount: row.taxAmount,
      settlementAmount: row.settlementAmountOrProfitLoss,
    },
  };
}


export function assessSbiCashTradeRows(rows: SbiTradeHistoryRow[]) {
  let cashCandidateRows = 0;
  let readyRows = 0;
  let needsReviewRows = 0;
  for (const row of rows) {
    if (!Object.hasOwn(CASH_TYPES, row.transactionType)) continue;
    cashCandidateRows += 1;
    if (toSbiCashTradeEvent(row).status === 'ready') readyRows += 1;
    else needsReviewRows += 1;
  }
  return {
    cashCandidateRows,
    readyRows,
    needsReviewRows,
    requiresOpeningCheckpoint: true as const,
  };
}
