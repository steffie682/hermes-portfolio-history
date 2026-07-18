export type SbiClassifiedAsset = 'stock' | 'investment-fund' | 'unknown';
export type SbiTradeOperation =
  | 'buy'
  | 'sell'
  | 'conversion'
  | 'margin-open-long'
  | 'margin-open-short'
  | 'margin-close-long'
  | 'margin-close-short'
  | 'reinvestment'
  | 'unknown';
export type SbiPostingSupport =
  | 'ready'
  | 'needs-margin-ledger'
  | 'needs-distribution-details'
  | 'needs-review';

interface ClassificationDefinition {
  kind: string;
  assetClass: SbiClassifiedAsset;
  operation: SbiTradeOperation;
  support: SbiPostingSupport;
}

const TRANSACTION_CLASSIFICATIONS: Readonly<Record<string, ClassificationDefinition>> = {
  株式現物買: { kind: 'stock-spot-buy', assetClass: 'stock', operation: 'buy', support: 'ready' },
  株式現物売: { kind: 'stock-spot-sell', assetClass: 'stock', operation: 'sell', support: 'ready' },
  現引: { kind: 'stock-margin-delivery', assetClass: 'stock', operation: 'conversion', support: 'needs-margin-ledger' },
  信用新規買: { kind: 'stock-margin-open-long', assetClass: 'stock', operation: 'margin-open-long', support: 'needs-margin-ledger' },
  信用新規売: { kind: 'stock-margin-open-short', assetClass: 'stock', operation: 'margin-open-short', support: 'needs-margin-ledger' },
  信用返済買: { kind: 'stock-margin-close-short', assetClass: 'stock', operation: 'margin-close-short', support: 'needs-margin-ledger' },
  信用返済売: { kind: 'stock-margin-close-long', assetClass: 'stock', operation: 'margin-close-long', support: 'needs-margin-ledger' },
  投信金額解約: { kind: 'fund-redemption', assetClass: 'investment-fund', operation: 'sell', support: 'ready' },
  投信金額買付: { kind: 'fund-purchase', assetClass: 'investment-fund', operation: 'buy', support: 'ready' },
  '投信金額買付(募集)': { kind: 'fund-subscription', assetClass: 'investment-fund', operation: 'buy', support: 'ready' },
  分配金再投資: { kind: 'fund-distribution-reinvestment', assetClass: 'investment-fund', operation: 'reinvestment', support: 'needs-distribution-details' },
};

export interface SbiTransactionClassification extends ClassificationDefinition {
  raw: string;
}

export function classifySbiTransactionType(raw: string): SbiTransactionClassification {
  if (Object.hasOwn(TRANSACTION_CLASSIFICATIONS, raw)) {
    return { raw, ...TRANSACTION_CLASSIFICATIONS[raw] };
  }
  return {
    raw,
    kind: 'unknown',
    assetClass: 'unknown',
    operation: 'unknown',
    support: 'needs-review',
  };
}
