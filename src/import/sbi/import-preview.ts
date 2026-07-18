import {
  classifySbiTransactionType,
  type SbiPostingSupport,
} from './trade-classification';

export interface SbiPreviewSourceRow {
  sourceRowNumber: number;
  transactionType: string;
}

export interface SbiImportPreview {
  totalRows: number;
  automaticRows: number;
  deferredRows: number;
  hasDeferredRows: boolean;
  supportCounts: Record<SbiPostingSupport, number>;
}

export function buildSbiImportPreview(sourceRows: SbiPreviewSourceRow[]): SbiImportPreview {
  const supportCounts: Record<SbiPostingSupport, number> = {
    ready: 0,
    'needs-margin-ledger': 0,
    'needs-distribution-details': 0,
    'needs-review': 0,
  };
  for (const sourceRow of sourceRows) {
    const classification = classifySbiTransactionType(sourceRow.transactionType);
    supportCounts[classification.support] += 1;
  }
  const automaticRows = supportCounts.ready;
  const deferredRows = sourceRows.length - automaticRows;
  return {
    totalRows: sourceRows.length,
    automaticRows,
    deferredRows,
    hasDeferredRows: deferredRows > 0,
    supportCounts,
  };
}
