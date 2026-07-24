import {
  buildSbiBalanceReportSafeReport,
  type PdfStructurePage,
} from './balance-report-safe-report';

const MAX_UTF16_UNITS = 2_000_000;
const MAX_NONEMPTY_CELLS = 20_000;
const FORBIDDEN_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

export interface OcrTextPage {
  pageNumber: number;
  width: number;
  height: number;
  text: string;
}

function convertOcrPage(
  page: OcrTextPage,
  limits: { utf16Units: number; cellCount: number },
): PdfStructurePage {
  const text = page.text;
  page.text = '';
  limits.utf16Units += text.length;
  if (limits.utf16Units > MAX_UTF16_UNITS) throw new Error('ocr-text-too-large');
  if (FORBIDDEN_CHARACTERS.test(text)) throw new Error('ocr-text-forbidden-character');
  if (text.trim().length === 0) throw new Error('ocr-text-empty');

  const rowCount = text.split(/\r\n?|\n/u).length;
  const items: PdfStructurePage['items'] = [];
  let rowIndex = 0;
  for (const row of text.split(/\r\n?|\n/u)) {
    const cellCount = row.split('\t').length;
    let columnIndex = 0;
    for (const cell of row.split('\t')) {
      const cellText = cell.trim();
      if (cellText.length > 0) {
        limits.cellCount += 1;
        if (limits.cellCount > MAX_NONEMPTY_CELLS) throw new Error('ocr-text-too-many-cells');
        const columnWidth = page.width / Math.max(cellCount, 1);
        const rowHeight = page.height / Math.max(rowCount, 1);
        items.push({
          text: cellText,
          x: columnIndex * columnWidth,
          y: Math.max(0, page.height - ((rowIndex + 1) * rowHeight)),
          width: columnWidth,
          height: rowHeight,
        });
      }
      columnIndex += 1;
    }
    rowIndex += 1;
  }
  if (items.length === 0) throw new Error('ocr-text-empty');
  return {
    pageNumber: page.pageNumber,
    width: page.width,
    height: page.height,
    extractionMode: 'ocr',
    rawItemCount: items.length,
    discardedItemCount: 0,
    items,
  };
}

export function createSbiOcrSafeReportBuilder() {
  const limits = { utf16Units: 0, cellCount: 0 };
  const safePages: ReturnType<typeof buildSbiBalanceReportSafeReport>['pages'] = [];
  return {
    safePages,
    addPage(page: OcrTextPage) {
      const structurePage = convertOcrPage(page, limits);
      const safePage = buildSbiBalanceReportSafeReport([structurePage]).pages[0];
      safePages.push(safePage);
      structurePage.items.length = 0;
    },
    finish() {
      const hasKnownLabel = safePages.some((page) =>
        page.items.some((item) => item.kind === 'known-label'));
      if (!hasKnownLabel) throw new Error('ocr-known-label-required');
      return {
        schemaVersion: 1 as const,
        documentKind: 'sbi-balance-report-structure' as const,
        pageCount: safePages.length,
        pages: safePages,
      };
    },
  };
}

export function buildSbiBalanceReportSafeReportFromOcr(ocrPages: OcrTextPage[]) {
  const builder = createSbiOcrSafeReportBuilder();
  for (const page of ocrPages) builder.addPage(page);
  return builder.finish();
}
