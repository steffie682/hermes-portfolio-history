import {
  buildSbiIncomeStructureSafeReport,
  type PdfStructureItem,
} from '@/import/sbi/balance-report-safe-report';

const MAX_UTF16_UNITS = 2_000_000;
const MAX_ACCEPTED_CELLS = 20_000;
const FORBIDDEN_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
const BIDI_CONTROL = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

export function buildSbiPastedIncomeTextSafeReport(raw: string) {
  if (raw.length > MAX_UTF16_UNITS) throw new Error('pasted-text-too-large');
  if (raw.trim().length === 0) throw new Error('pasted-text-empty');
  if (FORBIDDEN_CONTROLS.test(raw) || BIDI_CONTROL.test(raw)) {
    throw new Error('pasted-text-forbidden-character');
  }

  const items: PdfStructureItem[] = [];
  let rowIndex = 0;
  let maximumColumnIndex = 0;
  for (const row of raw.split(/\r\n|\n|\r/)) {
    let columnIndex = 0;
    for (const cell of row.split('\t')) {
      if (cell.trim().length > 0) {
        if (items.length === MAX_ACCEPTED_CELLS) throw new Error('pasted-text-too-many-cells');
        items.push({
          text: cell,
          x: columnIndex * 10,
          y: rowIndex * 10,
          width: 0,
          height: 10,
        });
        maximumColumnIndex = Math.max(maximumColumnIndex, columnIndex);
      }
      columnIndex += 1;
    }
    rowIndex += 1;
  }

  return buildSbiIncomeStructureSafeReport([{
    pageNumber: 1,
    width: maximumColumnIndex * 10,
    height: rowIndex * 10,
    extractionMode: 'pasted-text',
    rawItemCount: items.length,
    discardedItemCount: 0,
    items,
  }]);
}
