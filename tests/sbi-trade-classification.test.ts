import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifySbiTransactionType } from '@/import/sbi/trade-classification';

describe('SBI trade classification', () => {
  it.each([
    ['株式現物買', 'stock-spot-buy', 'stock', 'buy', 'ready'],
    ['株式現物売', 'stock-spot-sell', 'stock', 'sell', 'ready'],
    ['現引', 'stock-margin-delivery', 'stock', 'conversion', 'needs-margin-ledger'],
    ['信用新規買', 'stock-margin-open-long', 'stock', 'margin-open-long', 'needs-margin-ledger'],
    ['信用新規売', 'stock-margin-open-short', 'stock', 'margin-open-short', 'needs-margin-ledger'],
    ['信用返済買', 'stock-margin-close-short', 'stock', 'margin-close-short', 'needs-margin-ledger'],
    ['信用返済売', 'stock-margin-close-long', 'stock', 'margin-close-long', 'needs-margin-ledger'],
    ['投信金額解約', 'fund-redemption', 'investment-fund', 'sell', 'ready'],
    ['投信金額買付', 'fund-purchase', 'investment-fund', 'buy', 'ready'],
    ['投信金額買付(募集)', 'fund-subscription', 'investment-fund', 'buy', 'ready'],
    ['分配金再投資', 'fund-distribution-reinvestment', 'investment-fund', 'reinvestment', 'needs-distribution-details'],
  ] as const)('classifies %s without guessing ledger semantics', (raw, kind, assetClass, operation, support) => {
    expect(classifySbiTransactionType(raw)).toEqual({ raw, kind, assetClass, operation, support });
  });

  it('covers every transaction name confirmed by the safe format report fixture', async () => {
    const report = JSON.parse(await readFile(resolve(process.cwd(), 'tests/fixtures/sbi/trade-history.format-report.json'), 'utf8')) as {
      categorySchema?: string;
      safeCategoryValues?: { 取引?: string[] };
    };
    expect(report.categorySchema).toBe('sbi-trade-history-v1');
    expect(report.safeCategoryValues?.取引).toEqual([
      '株式現物買', '株式現物売', '現引', '信用新規買', '信用新規売', '信用返済買',
      '信用返済売', '投信金額解約', '投信金額買付', '投信金額買付(募集)', '分配金再投資',
    ]);
    expect(report.safeCategoryValues?.取引?.map(classifySbiTransactionType).every(({ support }) => support !== 'needs-review')).toBe(true);
  });

  it.each(['将来追加された取引', 'toString', 'constructor', '__proto__', ' 株式現物買'])('keeps unknown or non-exact %s out of automatic posting', (raw) => {
    expect(classifySbiTransactionType(raw)).toEqual({
      raw,
      kind: 'unknown',
      assetClass: 'unknown',
      operation: 'unknown',
      support: 'needs-review',
    });
  });
});
