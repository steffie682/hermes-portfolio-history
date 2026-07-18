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

const KNOWN_LABELS = [
  '取引残高報告書', '信用取引', '建玉', '建株', '銘柄', '銘柄コード', '数量', '株数',
  '建単価', '約定単価', '現在値', '評価損益', '期日', '期限', '預り', '保証金',
  '受渡日', '約定日', '売買', '買建', '売建', '信用建玉', 'お預り証券', '証券残高',
] as const;
const MAX_PAGES = 100;
const MAX_ITEMS = 20_000;

function rounded(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value / 10) * 10;
}

function classify(text: string): Pick<SafePdfStructureItem, 'kind' | 'labels'> {
  const compact = text.replace(/\s+/g, '');
  const labels = KNOWN_LABELS.filter((label) => compact.includes(label));
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
  const itemCount = pages.reduce((total, page) => total + page.items.length, 0);
  if (pages.length > MAX_PAGES || itemCount > MAX_ITEMS) {
    throw new Error('SBI取引残高報告書PDFの構造が大きすぎます');
  }
  return {
    schemaVersion: 1 as const,
    documentKind: 'sbi-balance-report-structure' as const,
    pageCount: pages.length,
    pages: pages.map((page) => ({
      pageNumber: page.pageNumber,
      width: rounded(page.width),
      height: rounded(page.height),
      items: page.items.map((item): SafePdfStructureItem => ({
        ...classify(item.text),
        x: rounded(item.x),
        y: rounded(item.y),
        width: rounded(item.width),
        height: rounded(item.height),
      })),
    })),
  };
}
