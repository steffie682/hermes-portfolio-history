const MAX_CANDIDATES_PER_SECTION = 100;
const MIN_WORD_CONFIDENCE = 70;
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
type CandidateSection = 'domestic' | 'fund' | 'margin';
type TrustedLine = { line: OcrCandidateLine; words: OcrCandidateWord[]; text: string; tainted: boolean };
type SectionLine = TrustedLine & { section: CandidateSection | null; columnsReady: boolean };
const CANDIDATE_KEYS = ['deposits', 'collateral', 'domesticStockLots', 'fundBalances', 'margin'] as const;
function ascii(value: string) { return value.normalize('NFKC').replace(/[−―‐]/g, '-'); }
function compact(value: string) { return ascii(value).replace(/\s+/g, ''); }
function decimal(value: string): string | null {
  const normalized = compact(value).replace(/，/g, ',');
  const wrapped = normalized.match(/^\(([+-]?(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)(?:\.\d+)?)(?:円|株|口)?\)$/);
  const plain = normalized.match(/^([+-]?(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)(?:\.\d+)?)(?:円|株|口)?$/);
  const token = wrapped?.[1] ?? plain?.[1];
  if (!token) return null;
  const cleaned = token.replace(/,/g, '');
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
    : /^[\[(（【]([0-9][0-9A-HJ-NP-UW-Y][0-9][0-9A-HJ-NP-UW-Y])[\])）】]$/;
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
  const wrapped = text.match(/^(?:【(.+)】|\[(.+)\])$/u);
  const marker = wrapped?.[1] ?? wrapped?.[2] ?? text;
  if (/(先物|オプション)/.test(marker)) return 'other';
  if (marker === '国内株式') return 'domestic'; if (marker === '投資信託') return 'fund';
  if (/^(?:信用取引の?建玉残高|信用建玉残高)$/.test(marker)) return 'margin';
  if (/(預り金|保証金|担保|信用取引|建玉|債券|外国株|外貨|合計)/.test(marker)) return 'other'; return null;
}
type HeaderSpec = { from: number; to: number; pattern: RegExp };
function provenHeader(words: OcrCandidateWord[], width: number, specs: HeaderSpec[]) {
  const matches = specs.map((spec) => words.find((word) => {
    const center = ((word.bbox.x0 + word.bbox.x1) / 2) / width;
    return center >= spec.from && center < spec.to && (word.bbox.x1 - word.bbox.x0) / width <= 0.14
      && spec.pattern.test(compact(word.text));
  }));
  if (matches.some((word) => !word)) return false;
  return matches.every((word, index) => index === 0 || word!.bbox.x0 > matches[index - 1]!.bbox.x0
    && word!.bbox.x0 >= matches[index - 1]!.bbox.x1);
}
function isColumnHeader(_text: string, section: CandidateSection, words: OcrCandidateWord[], width: number) {
  if (section === 'margin') {
    const liveSbi = provenHeader(words, width, [
      { from: 0, to: 0.26, pattern: /銘柄/ }, { from: 0.24, to: 0.33, pattern: /コード/ },
      { from: 0.29, to: 0.39, pattern: /数量/ }, { from: 0.35, to: 0.48, pattern: /区分/ },
      { from: 0.43, to: 0.56, pattern: /約定年月日/ }, { from: 0.5, to: 0.66, pattern: /約定単価/ },
      { from: 0.59, to: 0.75, pattern: /(?:時価|現在値)/ }, { from: 0.68, to: 0.84, pattern: /手数料/ },
      { from: 0.77, to: 0.93, pattern: /評価損益/ }, { from: 0.88, to: 1.01, pattern: /(?:最終決済|決済予定)/ },
    ]);
    return liveSbi || provenHeader(words, width, [
      { from: 0, to: 0.26, pattern: /銘柄/ }, { from: 0.26, to: 0.33, pattern: /指定/ },
      { from: 0.33, to: 0.44, pattern: /数量/ }, { from: 0.44, to: 0.52, pattern: /区分/ },
      { from: 0.52, to: 0.63, pattern: /約定年月日/ }, { from: 0.63, to: 0.72, pattern: /約定単価/ },
      { from: 0.72, to: 0.79, pattern: /(?:時価|現在値)/ }, { from: 0.79, to: 0.85, pattern: /手数料/ },
      { from: 0.85, to: 0.91, pattern: /評価損益/ }, { from: 0.91, to: 1.01, pattern: /(?:最終決済|決済予定)/ },
    ]);
  }
  if (section === 'fund') return provenHeader(words, width, [
    { from: 0, to: 0.4, pattern: /銘柄/ }, { from: 0.55, to: 0.7, pattern: /(?:数量|口数)/ },
    { from: 0.7, to: 0.86, pattern: /(?:参考価格|基準価額)/ }, { from: 0.86, to: 1.01, pattern: /評価額/ },
  ]);
  return provenHeader(words, width, [
    { from: 0, to: 0.4, pattern: /銘柄/ }, { from: 0.52, to: 0.66, pattern: /数量/ },
    { from: 0.66, to: 0.84, pattern: /(?:取得価格|取得単価|単価)/ },
    { from: 0.84, to: 1.01, pattern: /(?:買付金額|取得金額|金額)/ },
  ]);
}
function sectionLines(lines: TrustedLine[], width: number): SectionLine[] {
  let section: CandidateSection | null = null; let columnsReady = false;
  return lines.map((trusted) => {
    if (trusted.tainted) { section = null; columnsReady = false; return { ...trusted, section: null, columnsReady: false }; }
    const marker = sectionMarker(trusted.text);
    if (marker !== null) { section = marker === 'other' ? null : marker; columnsReady = false; return { ...trusted, section: null, columnsReady: false }; }
    if (section && isColumnHeader(trusted.text, section, trusted.words, width)) { columnsReady = true; return { ...trusted, section: null, columnsReady: false }; }
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
function oneColumnValue(line: SectionLine, width: number, from: number, to: number) {
  const values = wordsInColumn([line], width, from, to);
  return values.length === 1 && values[0] ? compact(values[0]) : null;
}
function canonicalMarginDecimal(value: string, options: { scale: number; positive?: boolean; signed?: boolean }) {
  const parsed = decimal(value);
  if (parsed === null || (!options.signed && parsed.startsWith('-'))) return null;
  const [integer, fraction = ''] = parsed.split('.');
  if (integer.replace('-', '').length > 18 || fraction.length > options.scale) return null;
  const trimmedFraction = fraction.replace(/0+$/, '');
  const canonical = trimmedFraction ? `${integer}.${trimmedFraction}` : integer;
  if (options.positive && /^-?0(?:\.0*)?$/.test(canonical)) return null;
  return canonical;
}
function optionalMarginDecimal(
  value: string | null,
  options: { scale: number; positive?: boolean; signed?: boolean },
) {
  if (value === null || value === '-' || value === '―' || value === '－') return '';
  return canonicalMarginDecimal(value, options);
}
const MARGIN_MARKETS = { 東京: 'tokyo', PTS: 'private', 私設取引システム: 'private', 名古屋: 'nagoya', 福岡: 'fukuoka', 札幌: 'sapporo' } as const;
const LIVE_MARGIN_PRIMARY_COLUMNS: Array<[number, number]> = [
  [0, 0.24], [0.24, 0.29], [0.29, 0.35], [0.35, 0.43], [0.43, 0.5],
  [0.5, 0.59], [0.59, 0.68], [0.68, 0.77], [0.77, 0.88], [0.88, 1.01],
];
const LIVE_MARGIN_CONTINUATION_COLUMNS: Array<[number, number]> = [[0, 0.24], [0.29, 0.35], [0.35, 0.43]];
function wordsFitColumns(line: SectionLine, width: number, columns: Array<[number, number]>) {
  const sorted = [...line.words].sort((left, right) => left.bbox.x0 - right.bbox.x0);
  return sorted.every((word, index) => columns.some(([from, to]) => word.bbox.x0 / width >= from
    && word.bbox.x1 / width <= to) && (index === 0 || word.bbox.x0 >= sorted[index - 1].bbox.x1));
}
function sameLiveMarginRow(primary: SectionLine, secondary: SectionLine, page: OcrCandidatePage) {
  const primaryHeight = primary.line.bbox.y1 - primary.line.bbox.y0;
  const secondaryHeight = secondary.line.bbox.y1 - secondary.line.bbox.y0;
  const parentGap = secondary.line.bbox.y0 - primary.line.bbox.y1;
  const primaryWordBottom = Math.max(...primary.words.map((word) => word.bbox.y1));
  const secondaryWordTop = Math.min(...secondary.words.map((word) => word.bbox.y0));
  const minimumWordHeight = Math.min(...[...primary.words, ...secondary.words]
    .map((word) => word.bbox.y1 - word.bbox.y0));
  const wordGap = secondaryWordTop - primaryWordBottom;
  return parentGap >= 0 && parentGap <= Math.max(2, Math.min(primaryHeight, secondaryHeight) * 0.5)
    && wordGap >= 0 && wordGap <= Math.max(2, minimumWordHeight * 0.5)
    && wordsFitColumns(primary, page.width, LIVE_MARGIN_PRIMARY_COLUMNS)
    && wordsFitColumns(secondary, page.width, LIVE_MARGIN_CONTINUATION_COLUMNS);
}
function parseLiveSbiMarginLines(primary: SectionLine, secondary: SectionLine, page: OcrCandidatePage): Record<string, string> | null {
  const identity = oneColumnValue(primary, page.width, 0, 0.24);
  const code = oneColumnValue(primary, page.width, 0.24, 0.29)?.toUpperCase() ?? null;
  const quantityValue = oneColumnValue(primary, page.width, 0.29, 0.35);
  const marketValue = oneColumnValue(secondary, page.width, 0.29, 0.35);
  const sideValue = oneColumnValue(primary, page.width, 0.35, 0.43);
  const stateValue = oneColumnValue(secondary, page.width, 0.35, 0.43);
  const designation = oneColumnValue(secondary, page.width, 0, 0.24);
  const contractDate = isoDate(oneColumnValue(primary, page.width, 0.43, 0.5) ?? '');
  const contractUnitPrice = canonicalMarginDecimal(oneColumnValue(primary, page.width, 0.5, 0.59) ?? '', { scale: 6, positive: true });
  const currentPrice = optionalMarginDecimal(oneColumnValue(primary, page.width, 0.59, 0.68), { scale: 6, positive: true });
  const fees = optionalMarginDecimal(oneColumnValue(primary, page.width, 0.68, 0.77), { scale: 2 });
  const unrealizedPnl = optionalMarginDecimal(oneColumnValue(primary, page.width, 0.77, 0.88), { scale: 2, signed: true });
  const finalDate = isoDate(oneColumnValue(primary, page.width, 0.88, 1.01) ?? '');
  const identityMatch = identity?.match(/^(.*?)[(（]([^()（）]*期限)[)）]$/u);
  const codeMatch = code?.match(/^([0-9][0-9A-HJ-NP-UW-Y][0-9][0-9A-HJ-NP-UW-Y])$/u);
  const quantity = canonicalMarginDecimal(quantityValue ?? '', { scale: 6, positive: true });
  const market = marketValue ? MARGIN_MARKETS[marketValue as keyof typeof MARGIN_MARKETS] ?? null : null;
  const side = sideValue === '買' ? 'buy' : sideValue === '売' ? 'sell' : null;
  const state = stateValue === '未決済' ? 'open' : stateValue === '決済ずみ' ? 'settled' : null;
  if (!identityMatch || !validText(identityMatch[1], 100) || !validText(identityMatch[2], 50) || !codeMatch
    || (designation !== null && !validText(designation, 50)) || !quantity || !market || !side || !state
    || !contractDate || !positive(contractUnitPrice) || currentPrice === null || fees === null || unrealizedPnl === null
    || !finalDate || finalDate < contractDate) return null;
  const designationLabel = designation === null || /^[-―－]$/.test(designation) ? '' : designation;
  return { _localId: localId(page, 'margin', primary, codeMatch[1]), state, securityCode: codeMatch[1],
    securityName: identityMatch[1], repaymentTermLabel: identityMatch[2], designationLabel,
    quantity, market, side, contractDate, contractUnitPrice, currentPrice, fees, unrealizedPnl,
    finalSettlementOrPlannedDate: finalDate, sourcePage: String(page.pageNumber), sourceRow: '' };
}
function parseMarginLine(line: SectionLine, page: OcrCandidatePage): Record<string, string> | null {
  const identity = oneColumnValue(line, page.width, 0, 0.26);
  const designation = oneColumnValue(line, page.width, 0.26, 0.33);
  const quantityMarket = oneColumnValue(line, page.width, 0.33, 0.44);
  const classification = oneColumnValue(line, page.width, 0.44, 0.52);
  const contractDate = isoDate(oneColumnValue(line, page.width, 0.52, 0.63) ?? '');
  const contractUnitPrice = canonicalMarginDecimal(oneColumnValue(line, page.width, 0.63, 0.72) ?? '', { scale: 6, positive: true });
  const currentPrice = optionalMarginDecimal(oneColumnValue(line, page.width, 0.72, 0.79), { scale: 6, positive: true });
  const fees = optionalMarginDecimal(oneColumnValue(line, page.width, 0.79, 0.85), { scale: 2 });
  const unrealizedPnl = optionalMarginDecimal(oneColumnValue(line, page.width, 0.85, 0.91), { scale: 2, signed: true });
  const finalDate = isoDate(oneColumnValue(line, page.width, 0.91, 1.01) ?? '');
  const identityMatch = identity?.match(/^(.*?)[\[(（【]([0-9][0-9A-HJ-NP-UW-Y][0-9][0-9A-HJ-NP-UW-Y])[\])）】](.+)$/u);
  const quantityMatch = quantityMarket?.match(/^([+]?\d+(?:\.\d+)?)(?:株|口)?(東京|PTS|私設取引システム|名古屋|福岡|札幌)$/u);
  const market = quantityMatch ? MARGIN_MARKETS[quantityMatch[2] as keyof typeof MARGIN_MARKETS] : null;
  const quantity = quantityMatch ? canonicalMarginDecimal(quantityMatch[1], { scale: 6, positive: true }) : null;
  const classificationMatch = classification?.match(/^(買|売)(未決済|決済ずみ)$/u);
  const side = classificationMatch?.[1] === '買' ? 'buy' : classificationMatch?.[1] === '売' ? 'sell' : null;
  const state = classificationMatch?.[2] === '未決済' ? 'open' : classificationMatch?.[2] === '決済ずみ' ? 'settled' : null;
  if (!identityMatch || !validText(identityMatch[1], 100) || !validText(identityMatch[3], 50)
    || designation === null || !quantityMatch || !quantity || !market || !side || !state || !contractDate || !finalDate
    || !positive(contractUnitPrice) || currentPrice === null || fees === null || unrealizedPnl === null
    || Number(quantityMatch[1]) <= 0 || finalDate < contractDate) return null;
  const designationLabel = /^[-―－]$/.test(designation) ? '' : designation;
  if (designationLabel && !validText(designationLabel, 50)) return null;
  return { _localId: localId(page, 'margin', line, identityMatch[2]), state, securityCode: identityMatch[2],
    securityName: identityMatch[1], repaymentTermLabel: identityMatch[3], designationLabel,
    quantity, market, side, contractDate, contractUnitPrice,
    currentPrice, fees, unrealizedPnl, finalSettlementOrPlannedDate: finalDate,
    sourcePage: String(page.pageNumber), sourceRow: '' };
}
function verticallyCoherent(line: SectionLine, page: OcrCandidatePage) {
  const height = line.line.bbox.y1 - line.line.bbox.y0;
  if (height > Math.max(4, page.height * 0.025)) return false;
  const centers = line.words.map((word) => (word.bbox.y0 + word.bbox.y1) / 2);
  if (centers.length === 0) return false;
  return Math.max(...centers) - Math.min(...centers) <= Math.max(2, page.height * 0.005);
}
function localId(page: OcrCandidatePage, section: CandidateSection, start: SectionLine, code: string) {
  return `${page.pageNumber}:${section}:${start.line.bbox.y0}:${page.height}:${code}`;
}
function exactIdentity(row: Record<string, string>) {
  return Object.keys(row).filter((key) => key !== '_localId').sort().map((key) => `${key}=${row[key]}`).join('\u001f');
}
export function emptyBalanceReportOcrCandidates(): BalanceReportOcrCandidates {
  return { deposits: [], collateral: [], domesticStockLots: [], fundBalances: [], margin: [], limitReached: false };
}
function samePhysicalRow(left: Record<string, string>, right: Record<string, string>) {
  if (exactIdentity(left) !== exactIdentity(right)) return false;
  const parse = (value: string) => value.match(/^(\d+):(domestic|fund|margin):([0-9]+(?:\.[0-9]+)?):([0-9]+(?:\.[0-9]+)?):([^:]+)$/);
  const a = parse(left._localId ?? ''); const b = parse(right._localId ?? '');
  return Boolean(a && b && a[1] === b[1] && a[2] === b[2] && a[5] === b[5]
    && Math.abs(Number(a[3]) / Number(a[4]) - Number(b[3]) / Number(b[4])) <= 0.003);
}
export function mergeBalanceReportOcrCandidates(current: BalanceReportOcrCandidates, next: BalanceReportOcrCandidates): BalanceReportOcrCandidates {
  const merged = emptyBalanceReportOcrCandidates(); merged.limitReached = current.limitReached === true || next.limitReached === true;
  for (const key of CANDIDATE_KEYS) {
    const rows: Record<string, string>[] = [];
    for (const row of [...current[key], ...next[key]]) {
      const duplicate = rows.findIndex((existing) => samePhysicalRow(existing, row)
        || (!validText(existing._localId ?? '', 100) && !validText(row._localId ?? '', 100) && exactIdentity(existing) === exactIdentity(row)));
      if (duplicate >= 0) rows[duplicate] = row; else rows.push(row);
    }
    if (rows.length > MAX_CANDIDATES_PER_SECTION) merged.limitReached = true;
    merged[key] = rows.slice(0, MAX_CANDIDATES_PER_SECTION);
  }
  return merged;
}
export function hasStructurallyProvenPositionCandidate(candidates: BalanceReportOcrCandidates) {
  return candidates.domesticStockLots.length > 0 || candidates.fundBalances.length > 0 || candidates.margin.length > 0;
}

export function countBalanceReportOcrCandidates(candidates: BalanceReportOcrCandidates) {
  return CANDIDATE_KEYS.reduce((count, key) => count + candidates[key].length, 0);
}
export function extractBalanceReportOcrCandidates(pages: OcrCandidatePage[]): BalanceReportOcrCandidates {
  const result = emptyBalanceReportOcrCandidates();
  for (const page of pages) {
    if (!Number.isInteger(page.pageNumber) || page.pageNumber < 1 || !Number.isFinite(page.width) || page.width <= 0 || !Number.isFinite(page.height) || page.height <= 0) continue;
    const lines = sectionLines(trustedLines(page), page.width);
    for (let index = 0; index < lines.length; index += 1) {
      const entry = lines[index];
      if (entry.section !== 'margin' || !entry.columnsReady || !verticallyCoherent(entry, page)) continue;
      let candidate = parseMarginLine(entry, page);
      const secondary = lines[index + 1];
      if (!candidate && secondary?.section === 'margin' && secondary.columnsReady && !secondary.tainted
        && verticallyCoherent(secondary, page) && sameLiveMarginRow(entry, secondary, page)) {
        candidate = parseLiveSbiMarginLines(entry, secondary, page);
      }
      if (candidate) result.margin.push(candidate);
    }
    const starts = lines.map((entry) => {
      if (!entry.section || entry.section === 'margin' || !entry.columnsReady || !verticallyCoherent(entry, page)) return null;
      const range = entry.section === 'fund' ? [0.2, 0.45] : [0.2, 0.38];
      const codeWord = entry.words.find((word) => {
        const x = word.bbox.x0 / page.width;
        return x >= range[0] && x < range[1] && codeFrom(word.text, entry.section!) !== null;
      });
      const code = codeWord ? codeFrom(codeWord.text, entry.section) : null;
      return code ? { line: entry, code, section: entry.section } : null;
    }).filter((entry): entry is { line: SectionLine; code: string; section: 'domestic' | 'fund' } => entry !== null);
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
