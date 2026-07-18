import type { SbiTradeHistoryRow } from './trade-history';

function isPositiveDecimal(value: string): boolean {
  return value.length <= 64 && /^\d+(?:\.\d+)?$/.test(value) && /[1-9]/.test(value);
}

export function toSbiDistributionReinvestmentEvent(row: SbiTradeHistoryRow) {
  if (row.transactionType !== '分配金再投資') {
    return { status: 'needs-review' as const, sourceRowNumber: row.sourceRowNumber, reason: 'unsupported-transaction-type' as const };
  }
  if (!isPositiveDecimal(row.quantity)) {
    return { status: 'needs-review' as const, sourceRowNumber: row.sourceRowNumber, reason: 'invalid-quantity' as const };
  }
  if (!isPositiveDecimal(row.unitPrice)) {
    return { status: 'needs-review' as const, sourceRowNumber: row.sourceRowNumber, reason: 'invalid-unit-price' as const };
  }
  return {
    status: 'units-ready' as const,
    event: {
      sourceRowNumber: row.sourceRowNumber,
      assetClass: 'fund' as const,
      operation: 'reinvestment-units' as const,
      instrument: { securityCode: row.securityCode, securityName: row.securityName },
      contractDate: row.contractDate,
      settlementDate: row.settlementDate,
      custodyType: row.custodyType,
      taxationType: row.taxationType,
      quantityIncrease: row.quantity,
      sourceQuotedUnitPrice: { value: row.unitPrice, basis: 'unverified' as const },
      cashTreatment: 'unresolved' as const,
      taxTreatment: 'unresolved' as const,
      costBasisTreatment: 'unresolved' as const,
    },
  };
}


export function assessSbiDistributionReinvestments(rows: SbiTradeHistoryRow[]) {
  let candidateRows = 0;
  let unitsReadyRows = 0;
  for (const row of rows) {
    if (row.transactionType !== '分配金再投資') continue;
    candidateRows += 1;
    if (toSbiDistributionReinvestmentEvent(row).status === 'units-ready') unitsReadyRows += 1;
  }
  return {
    candidateRows,
    unitsReadyRows,
    needsReviewRows: candidateRows - unitsReadyRows,
    requiresDistributionDetails: candidateRows > 0,
  };
}
