import { describe, expect, it } from 'vitest';
import { buildSbiImportPreview } from '@/import/sbi/import-preview';

describe('SBI staged import preview', () => {
  it('separates automatically supported and deferred rows without dropping either', () => {
    const preview = buildSbiImportPreview([
      { sourceRowNumber: 6, transactionType: '株式現物買' },
      { sourceRowNumber: 7, transactionType: '投信金額解約' },
      { sourceRowNumber: 8, transactionType: '信用新規買' },
      { sourceRowNumber: 9, transactionType: '現引' },
      { sourceRowNumber: 10, transactionType: '分配金再投資' },
      { sourceRowNumber: 11, transactionType: '未知取引' },
    ]);

    expect(preview).toMatchObject({
      totalRows: 6,
      automaticRows: 2,
      deferredRows: 4,
      hasDeferredRows: true,
    });
    expect(preview.rows.map(({ sourceRowNumber, support }) => [sourceRowNumber, support])).toEqual([
      [6, 'ready'],
      [7, 'ready'],
      [8, 'needs-margin-ledger'],
      [9, 'needs-margin-ledger'],
      [10, 'needs-distribution-details'],
      [11, 'needs-review'],
    ]);
    expect(preview.supportCounts).toEqual({
      ready: 2,
      'needs-margin-ledger': 2,
      'needs-distribution-details': 1,
      'needs-review': 1,
    });
  });

  it.each([
    [[], 0],
    [[{ sourceRowNumber: 6, transactionType: '株式現物買' }], 1],
  ])('reports no deferred rows when every one of %s rows is supported', (rows, automaticRows) => {
    expect(buildSbiImportPreview(rows)).toMatchObject({
      totalRows: automaticRows,
      automaticRows,
      deferredRows: 0,
      hasDeferredRows: false,
    });
  });
});
