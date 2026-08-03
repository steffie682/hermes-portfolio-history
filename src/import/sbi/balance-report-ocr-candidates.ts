const MAX_CANDIDATES_PER_SECTION = 100;
const MIN_WORD_CONFIDENCE = 30;
const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
type Box = { x0: number; y0: number; x1: number; y1: number };
export type OcrCandidateWord = { text: string; confidence: number; bbox: Box };
export type OcrCandidateLine = { text: string; confidence: number; bbox: Box; words: OcrCandidateWord[] };
export type OcrCandidateBlock = { paragraphs: Array<{ lines: OcrCandidateLine[] }> };
export type OcrCandidatePage = { pageNumber: number; width: number; height: number; blocks: OcrCandidateBlock[] | null };
export type BalanceReportOcrCandidates = {
  deposits: Record<string, string>[]; collateral: Record<string, string>[];
  domesticStockLots: Record<string, string>[]; fundBalances: Record<string, string>[];
  margin: Record<string, string>[]; limitReached: boolean;
};
type CandidateSection = 'domestic' | 'fund';
type TrustedLine = { line: OcrCandidateLine; words: OcrCandidateWord[]; text: string; tainted: boolean };
type SectionLine = TrustedLine & { section: CandidateSection | null; columnsReady: boolean };
const CANDIDATE_KEYS = ['deposits', 'collateral', 'domesticStockLots', 'fundBalances', 'margin'] as const;
function ascii(value: string) { return value.normalize('NFKC').replace(/[−―‐]/g, '-'); }
function compact(value: string) { return ascii(value).replace(/\s+/g, ''); }
function decimal(value: string): string | null {
  const cleaned = ascii(value).replace(/[(),，（）円株口]/g, '').trim();
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const number = Number(cleaned); if (!Number.isFinite(number)) return null;
  const canonical = cleaned.replace(/^\+/, '').replace(/^(-?)0+(?=\d)/, '$1');
  return canonical === '-0' ? '0' : canonical;
}
function isoDate(value: string): string | null {
  const match = ascii(value).match(/^(20\d{2})[/.\-](\d{1,2})[/.\-](\d{1,2})$/); if (!match) return null;
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${match[1]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function codeFrom(value: string, section: CandidateSection): string | null {
  const token = compact(value).toUpperCase();
  const pattern = section === 'fund'
    ? /^[\[(（【](\d{3}\.\d{2})[\])）】]$/
    : /^[\[(（【]([A-Z0-9]{4})[\])）】]$/;
  return token.match(pattern)?.[1] ?? null;
}
function validText(value: string, max: number) { return value.length > 0 && value.length <= max && !FORBIDDEN.test(value); }
function validBox(box: Box, width: number, height: number) {
  return [box.x0, box.y0, box.x1, box.y1].every(Number.isFinite)
    && box.x0 >= 0 && box.y0 >= 0 && box.x1 > box.x0 && box.y1 > box.y0
    && box.x1 <= width && box.y1 <= height;
}
function boxContainedBy(word: Box, line: Box) {
  const tolerance = 1;
  return word.x0 >= line.x0 - tolerance && word.y0 >= line.y0 - tolerance
    && word.x1 <= line.x1 + tolerance && word.y1 <= line.y1 + tolerance;
}
function trustedLines(page: OcrCandidatePage): TrustedLine[] {
  const mapped = (page.blocks ?? []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines))
    .filter((line) => line.words.length > 0 || line.text.trim().length > 0)
    .map((line) => {
      const aggregateText = compact(line.text);
      const wordText = compact(line.words.map((word) => word.text).join(''));
      const lineTrusted = Number.isFinite(line.confidence) && line.confidence >= MIN_WORD_CONFIDENCE
        && validBox(line.bbox, page.width, page.height) && !FORBIDDEN.test(line.text) && line.text.length <= 500
        && aggregateText === wordText;
      const words = line.words.filter((word) => Number.isFinite(word.confidence)
        && word.confidence >= MIN_WORD_CONFIDENCE && validBox(word.bbox, page.width, page.height)
        && boxContainedBy(word.bbox, line.bbox) && validText(word.text, 100));
      const tainted = !lineTrusted || line.words.some((word) => !Number.isFinite(word.confidence)
        || word.confidence < MIN_WORD_CONFIDENCE || !validBox(word.bbox, page.width, page.height)
        || !boxContainedBy(word.bbox, line.bbox) || !validText(word.text, 100));
      return { line, words, text: compact(words.map((word) => word.text).join('')), tainted };
    });
  let previousY = Number.NEGATIVE_INFINITY;
  return mapped.map((entry) => {
    const y = entry.line.bbox.y0;
    const reversed = !Number.isFinite(y) || y + 1 < previousY;
    if (Number.isFinite(y)) previousY = Math.max(previousY, y);
    return { ...entry, tainted: entry.tainted || reversed };
  });
}
function sectionMarker(text: string): CandidateSection | 'other' | null {
  if (text.includes('国内株式')) return 'domestic'; if (text.includes('投資信託')) return 'fund';
  if (/(預り金|保証金|担保|信用取引|建玉|先物|オプション|債券|外国株|外貨|合計)/.test(text)) return 'other'; return null;
}
function isColumnHeader(text: string, section: CandidateSection) {
  const hasName = /(銘柄|銘柄名)/.test(text);
  if (section === 'fund') return hasName && /(数量|口数)/.test(text) && /(参考価格|基準価額)/.test(text) && /評価額/.test(text);
  return hasName && /数量/.test(text) && /(取得価格|取得単価|単価)/.test(text) && /(買付金額|取得金額|金額)/.test(text);
}
function sectionLines(lines: TrustedLine[]): SectionLine[] {
  let section: CandidateSection | null = null; let columnsReady = false;
  return lines.map((trusted) => {
    if (trusted.tainted) { section = null; columnsReady = false; return { ...trusted, section: null, columnsReady: false }; }
    const marker = sectionMarker(trusted.text);
    if (marker !== null) { section = marker === 'other' ? null : marker; columnsReady = false; return { ...trusted, section: null, columnsReady: false }; }
    if (section && isColumnHeader(trusted.text, section)) { columnsReady = true; return { ...trusted, section: null, columnsReady: false }; }
    return { ...trusted, section, columnsReady }; });
}
function wordsInColumn(lines: SectionLine[], width: number, from: number, to: number) {
  return lines.map(({ words }) => words.filter((word) => word.bbox.x0 / width >= from && word.bbox.x0 / width < to)
    .sort((a, b) => a.bbox.x0 - b.bbox.x0).map((word) => word.text).join(''));
}
function numbersIn(lines: SectionLine[], width: number, from: number, to: number) {
  return wordsInColumn(lines, width, from, to).map(decimal).filter((value): value is string => value !== null);
}
function nameIn(start: SectionLine, width: number, code: string, boundary: number) {
  return compact(start.words.filter((word) => word.bbox.x0 / width < boundary).map((word) => word.text).join(''))
    .replace(`[${code}]`, '').replace(`(${code})`, '').replace(`（${code}）`, '').replace(code, '')
    .replace(/銘柄計/g, '').replace(/[\[\]()（）【】]/g, '');
}
function positive(value: string | null): value is string { return value !== null && Number(value) > 0; }
function verticallyCoherent(line: SectionLine, page: OcrCandidatePage) {
  const height = line.line.bbox.y1 - line.line.bbox.y0;
  if (height > Math.max(4, page.height * 0.025)) return false;
  const centers = line.words.map((word) => (word.bbox.y0 + word.bbox.y1) / 2);
  if (centers.length === 0) return false;
  return Math.max(...centers) - Math.min(...centers) <= Math.max(2, page.height * 0.005);
}
function localId(page: OcrCandidatePage, section: CandidateSection, start: SectionLine, code: string) {
  return `${page.pageNumber}:${section}:${Math.round((start.line.bbox.y0 / page.height) * 100_000)}:${code}`;
}
function exactIdentity(row: Record<string, string>) {
  return Object.keys(row).filter((key) => key !== '_localId').sort().map((key) => `${key}=${row[key]}`).join('\u001f');
}
export function emptyBalanceReportOcrCandidates(): BalanceReportOcrCandidates {
  return { deposits: [], collateral: [], domesticStockLots: [], fundBalances: [], margin: [], limitReached: false };
}
export function mergeBalanceReportOcrCandidates(current: BalanceReportOcrCandidates, next: BalanceReportOcrCandidates): BalanceReportOcrCandidates {
  const merged = emptyBalanceReportOcrCandidates(); merged.limitReached = current.limitReached === true || next.limitReached === true;
  for (const key of CANDIDATE_KEYS) { const byLocalRow = new Map<string, Record<string, string>>();
    for (const row of [...current[key], ...next[key]]) { const identity = validText(row._localId ?? '', 100) ? `local:${row._localId}` : `exact:${exactIdentity(row)}`; byLocalRow.set(identity, row); }
    if (byLocalRow.size > MAX_CANDIDATES_PER_SECTION) merged.limitReached = true;
    merged[key] = [...byLocalRow.values()].slice(0, MAX_CANDIDATES_PER_SECTION); }
  return merged;
}
export function countBalanceReportOcrCandidates(candidates: BalanceReportOcrCandidates) {
  return CANDIDATE_KEYS.reduce((count, key) => count + candidates[key].length, 0);
}
export function extractBalanceReportOcrCandidates(pages: OcrCandidatePage[]): BalanceReportOcrCandidates {
  const result = emptyBalanceReportOcrCandidates();
  for (const page of pages) {
    if (!Number.isInteger(page.pageNumber) || page.pageNumber < 1 || !Number.isFinite(page.width) || page.width <= 0 || !Number.isFinite(page.height) || page.height <= 0) continue;
    const lines = sectionLines(trustedLines(page));
    const starts = lines.map((entry) => {
      if (!entry.section || !entry.columnsReady || !verticallyCoherent(entry, page)) return null;
      const range = entry.section === 'fund' ? [0.2, 0.45] : [0.2, 0.38];
      const codeWord = entry.words.find((word) => {
        const x = word.bbox.x0 / page.width;
        return x >= range[0] && x < range[1] && codeFrom(word.text, entry.section!) !== null;
      });
      const code = codeWord ? codeFrom(codeWord.text, entry.section) : null;
      return code ? { line: entry, code, section: entry.section } : null;
    }).filter((entry): entry is { line: SectionLine; code: string; section: CandidateSection } => entry !== null);
    for (const start of starts) {
      const row = [start.line];
      if (start.section === 'fund') {
        const name = nameIn(start.line, page.width, start.code, 0.45);
        const quantities = numbersIn(row, page.width, 0.56, 0.69);
        const prices = numbersIn(row, page.width, 0.69, 0.86);
        const evaluations = numbersIn(row, page.width, 0.86, 1.01);
        if (validText(name, 100) && quantities.length === 1 && prices.length === 1 && evaluations.length === 1
          && positive(quantities[0]) && positive(prices[0]) && positive(evaluations[0])) {
          result.fundBalances.push({ _localId: localId(page, 'fund', start.line, start.code),
            securityCode: start.code, securityName: name, units: quantities[0], referencePrice: prices[0],
            referencePriceUnit: '', evaluationAmount: evaluations[0], sourcePage: '', sourceRow: '' });
        }
        continue;
      }
      const name = nameIn(start.line, page.width, start.code, 0.38);
      const dates = wordsInColumn(row, page.width, 0.38, 0.53)
        .map((value) => isoDate(compact(value))).filter((value): value is string => value !== null);
      const quantities = numbersIn(row, page.width, 0.53, 0.65);
      const prices = numbersIn(row, page.width, 0.65, 0.82);
      const amounts = numbersIn(row, page.width, 0.82, 1.01);
      if (validText(name, 100) && dates.length === 1 && quantities.length === 1
        && prices.length >= 1 && prices.length <= 2 && amounts.length >= 1 && amounts.length <= 2
        && positive(quantities[0]) && positive(prices[0]) && positive(amounts[0])) {
        result.domesticStockLots.push({ _localId: localId(page, 'domestic', start.line, start.code),
          securityCode: start.code, securityName: name, acquisitionDate: dates[0], quantity: quantities[0],
          rowKind: 'acquisition_lot', acquisitionUnitPriceState: 'reported', acquisitionUnitPrice: prices[0],
          purchaseAmountState: 'reported', purchaseAmount: amounts[0],
          referencePrice: prices[1] ?? '', evaluationAmount: amounts[1] ?? '', sourcePage: '', sourceRow: '' });
      }
    }
  }
  for (const key of CANDIDATE_KEYS) { if (result[key].length > MAX_CANDIDATES_PER_SECTION) result.limitReached = true; result[key] = result[key].slice(0, MAX_CANDIDATES_PER_SECTION); }
  return result;
}
