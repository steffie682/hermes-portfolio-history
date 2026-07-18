import {
  classifySbiTransactionType,
  type SbiPostingSupport,
  type SbiTransactionClassification,
} from './trade-classification';

export interface SbiPreviewSourceRow {
  sourceRowNumber: number;
  transactionType: string;
}

export interface SbiImportPreviewRow extends SbiPreviewSourceRow {
  classification: SbiTransactionClassification;
  support: SbiPostingSupport;
}

export interface SbiImportPreview {
  totalRows: number;
  automaticRows: number;
  deferredRows: number;
  hasDeferredRows: boolean;
  supportCounts: Record<SbiPostingSupport, number>;
  rows: SbiImportPreviewRow[];
}

export function buildSbiImportPreview(sourceRows: SbiPreviewSourceRow[]): SbiImportPreview {
  const supportCounts: Record<SbiPostingSupport, number> = {
    ready: 0,
    'needs-margin-ledger': 0,
    'needs-distribution-details': 0,
    'needs-review': 0,
  };
  const rows = sourceRows.map((sourceRow) => {
    const classification = classifySbiTransactionType(sourceRow.transactionType);
    supportCounts[classification.support] += 1;
    return {
      ...sourceRow,
      classification,
      support: classification.support,
    };
  });
  const automaticRows = supportCounts.ready;
  const deferredRows = rows.length - automaticRows;
  return {
    totalRows: rows.length,
    automaticRows,
    deferredRows,
    hasDeferredRows: deferredRows > 0,
    supportCounts,
    rows,
  };
}
