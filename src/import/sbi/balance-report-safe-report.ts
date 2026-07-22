export interface PdfStructureItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfStructurePage {
  pageNumber: number;
  width: number;
  height: number;
  rawItemCount?: number;
  discardedItemCount?: number;
  items: PdfStructureItem[];
}

export type SafePdfItemKind = 'known-label' | 'date' | 'number' | 'masked-text' | 'punctuation';

export interface SafePdfStructureItem {
  kind: SafePdfItemKind;
  labels?: string[];
  x: number;
  y: number;
  width: number;
  height: number;
}

const BALANCE_REPORT_LABELS = [
  '取引残高報告書', '信用取引', '建玉', '建株', '銘柄', '銘柄コード', '数量', '株数',
  '建単価', '約定単価', '現在値', '評価損益', '期日', '期限', '預り', '保証金',
  '受渡日', '約定日', '売買', '買建', '売建', '信用建玉', 'お預り証券', '証券残高',
] as const;
const INCOME_STRUCTURE_LABELS = [
  '収益分配金', '普通分配金', '元本払戻金', '特別分配金', '再投資', '再投資口数',
  '分配金額', '所得税', '住民税', '基準価額', '個別元本', '口数',
] as const;
const MAX_PAGES = 100;
const MAX_ITEMS = 20_000;

function rounded(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value / 10) * 10;
}

function classify(
  text: string,
  knownLabels: readonly string[],
): Pick<SafePdfStructureItem, 'kind' | 'labels'> {
  const compact = text.replace(/\s+/g, '');
  const labels = knownLabels.filter((label) => compact.includes(label));
  if (labels.length > 0) return { kind: 'known-label', labels: [...labels] };
  if (/^(?:\d{4}[年/.\-]\d{1,2}[月/.\-]\d{1,2}日?|令和\d+年\d+月\d+日)$/.test(compact)) {
    return { kind: 'date' };
  }
  if (/^[+\-−△▲(（]?[\d０-９,，.．\s]+(?:円|株|口|%|％)?[)）]?$/.test(compact)) {
    return { kind: 'number' };
  }
  if (/^[\p{P}\p{S}]+$/u.test(compact)) return { kind: 'punctuation' };
  return { kind: 'masked-text' };
}

export function buildSbiBalanceReportSafeReport(pages: PdfStructurePage[]) {
  return buildSafeReport(pages, BALANCE_REPORT_LABELS, 'sbi-balance-report-structure');
}

function buildSafeReport<TDocumentKind extends string>(
  pages: PdfStructurePage[],
  knownLabels: readonly string[],
  documentKind: TDocumentKind,
) {
  const itemCount = pages.reduce((total, page) => total + page.items.length, 0);
  const pageDiagnostics = pages.map((page) => {
    const rawItemCount = page.rawItemCount ?? page.items.length;
    const discardedItemCount = page.discardedItemCount ?? 0;
    const valid = Number.isInteger(rawItemCount)
      && rawItemCount >= 0
      && rawItemCount <= MAX_ITEMS
      && Number.isInteger(discardedItemCount)
      && discardedItemCount >= 0
      && discardedItemCount <= MAX_ITEMS
      && rawItemCount === page.items.length + discardedItemCount;
    if (!valid) throw new Error('SBI取引残高報告書PDFの構造が大きすぎます');
    return { rawItemCount, discardedItemCount };
  });
  const rawItemCount = pageDiagnostics.reduce((total, page) => total + page.rawItemCount, 0);
  if (pages.length > MAX_PAGES || itemCount > MAX_ITEMS || rawItemCount > MAX_ITEMS) {
    throw new Error('SBI取引残高報告書PDFの構造が大きすぎます');
  }
  return {
    schemaVersion: 1 as const,
    documentKind,
    pageCount: pages.length,
    pages: pages.map((page, index) => ({
      pageNumber: page.pageNumber,
      width: rounded(page.width),
      height: rounded(page.height),
      ...pageDiagnostics[index],
      items: page.items.map((item): SafePdfStructureItem => ({
        ...classify(item.text, knownLabels),
        x: rounded(item.x),
        y: rounded(item.y),
        width: rounded(item.width),
        height: rounded(item.height),
      })),
    })),
  };
}

export function buildSbiIncomeStructureSafeReport(pages: PdfStructurePage[]) {
  return buildSafeReport(pages, INCOME_STRUCTURE_LABELS, 'sbi-income-structure' as const);
}
