export type GardenLot = {
  id: string; code: string; name: string; account: 'nisa' | 'taxable';
  shares: string; costPerShare: string; purchasedOn: string | null; confirmedOn: string;
  purchaseDps: string | null; currentDps: string | null; priorYearDps: string | null;
  dividendAsOf: string | null; dividendSource: string | null; memo: string;
};
export type GardenState = { revision: number; lots: GardenLot[] };
export type Quote = { code: string; close: string; date: string; source: string };
export type QuoteMap = Record<string, Quote>;
export type GardenRow = {
  lot: GardenLot; quote: Quote | null; cost: number; value: number | null;
  pnl: number | null; pnlPct: number | null; annualDividend: number | null;
  yieldOnCost: number | null; currentYield: number | null;
  dividendGrowth: number | null; yearDividendGrowth: number | null;
};
export type GardenTotals = {
  cost: number; value: number | null; pnl: number | null; pnlPct: number | null;
  annualDividend: number | null; yieldOnCost: number | null;
  missingQuotes: number; missingDividends: number;
  valuationOverflow?: boolean;
};
export class GardenValidationError extends Error {
  constructor() { super('Invalid garden'); }
}
export const MAX_LOTS = 200;
export const MAX_REVISION = 2_147_483_646;
export function isJpxCode(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9][0-9ACDFGHJKLMNPRSTUWXY][0-9][0-9ACDFGHJKLMNPRSTUWXY]$/.test(value);
}
export function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^(19|20|21)\d{2}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function isFinancialDecimal(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9]\d{0,6})(\.\d{1,4})?$/.test(value) && units(value) <= 10_000_000_000n;
}
function text(value: unknown, max: number, empty = false): value is string {
  return typeof value === 'string' && value.length <= max && (empty || value.trim().length > 0)
    && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(value);
}
function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
const LOT_KEYS = ['id', 'code', 'name', 'account', 'shares', 'costPerShare', 'purchasedOn', 'confirmedOn', 'purchaseDps', 'currentDps', 'priorYearDps', 'dividendAsOf', 'dividendSource', 'memo'];
export function validateGardenState(input: unknown, now = new Date()): GardenState {
  if (!Number.isFinite(now.getTime())) throw new GardenValidationError();
  const today = new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
  if (!exact(input, ['revision', 'lots']) || !Number.isInteger(input.revision)
    || (input.revision as number) < 0 || (input.revision as number) > MAX_REVISION
    || !Array.isArray(input.lots) || input.lots.length > MAX_LOTS) throw new GardenValidationError();
  const ids = new Set<string>();
  const sums = [0n, 0n, 0n, 0n];
  for (const lot of input.lots) {
    if (!exact(lot, LOT_KEYS)
      || typeof lot.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(lot.id)
      || ids.has(lot.id.toLowerCase()) || !isJpxCode(lot.code) || !text(lot.name, 100)
      || !['nisa', 'taxable'].includes(lot.account as string)
      || typeof lot.shares !== 'string' || !/^[1-9]\d{0,6}$/.test(lot.shares) || BigInt(lot.shares) > 1_000_000n
      || !isFinancialDecimal(lot.costPerShare) || !isDate(lot.confirmedOn) || lot.confirmedOn > today
      || (lot.purchasedOn !== null && (!isDate(lot.purchasedOn) || lot.purchasedOn > lot.confirmedOn))
      || (lot.dividendAsOf !== null && (!isDate(lot.dividendAsOf) || lot.dividendAsOf > today))
      || (['purchaseDps', 'currentDps', 'priorYearDps'].some(key => lot[key] !== null)
        && (lot.dividendAsOf === null || lot.dividendSource === null))
      || (lot.dividendSource !== null && !text(lot.dividendSource, 300)) || !text(lot.memo, 1000, true)
      || ['purchaseDps', 'currentDps', 'priorYearDps'].some(key => lot[key] !== null && !isFinancialDecimal(lot[key]))) {
      throw new GardenValidationError();
    }
    ['costPerShare', 'purchaseDps', 'currentDps', 'priorYearDps'].forEach((key, index) => {
      if (lot[key] !== null) sums[index] += BigInt(lot.shares as string) * units(lot[key] as string);
      if (sums[index] > MAX_AMOUNT_UNITS) throw new GardenValidationError();
    });
    ids.add(lot.id.toLowerCase());
  }
  return { revision: input.revision as number, lots: input.lots.map(lot => ({ ...lot })) as GardenLot[] };
}

// All arithmetic uses fixed 1/10000 JPY BigInts. Public numbers are display-only:
// currency has four decimal places; percentages round half away from zero to 6 places.
const SCALE = 10_000n;
// Aggregate cap: 100 billion JPY; fixed units stay below MAX_SAFE_INTEGER.
const MAX_AMOUNT_UNITS = 1_000_000_000_000_000n;
function units(value: string): bigint {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(4, '0'));
}
function money(value: bigint): number { return Number(value) / Number(SCALE); }
function percent(numerator: bigint, denominator: bigint): number | null {
  if (denominator === 0n) return null;
  const scaled = numerator * 100_000_000n;
  const sign = scaled < 0n ? -1n : 1n;
  return Number(sign * ((scaled * sign + denominator / 2n) / denominator)) / 1_000_000;
}
export function calculateGarden(lots: GardenLot[], quotes: QuoteMap): { rows: GardenRow[]; totals: GardenTotals } {
  validateGardenState({ revision: 0, lots });
  let costSum = 0n, valueSum = 0n, dividendSum = 0n;
  let missingQuotes = 0, missingDividends = 0;
  const rows = lots.map((lot): GardenRow => {
    const shares = BigInt(lot.shares), cost = shares * units(lot.costPerShare);
    const candidate = Object.hasOwn(quotes, lot.code) ? quotes[lot.code] : null;
    const quote = candidate && candidate.code === lot.code && isFinancialDecimal(candidate.close)
      && units(candidate.close) > 0n && isDate(candidate.date) && text(candidate.source, 300) ? candidate : null;
    const rawValue = quote ? shares * units(quote.close) : null;
    // Keep the quote as provenance, but never convert an over-bound amount to a display number.
    const value = rawValue !== null && rawValue <= MAX_AMOUNT_UNITS ? rawValue : null;
    const dps = lot.currentDps === null ? null : units(lot.currentDps);
    const dividend = dps === null ? null : shares * dps;
    const growth = (baseline: string | null) => dps === null || baseline === null
      ? null : percent(dps - units(baseline), units(baseline));
    costSum += cost;
    if (rawValue === null) missingQuotes++; else valueSum += rawValue;
    if (dividend === null) missingDividends++; else dividendSum += dividend;
    return { lot, quote, cost: money(cost), value: value === null ? null : money(value),
      pnl: value === null ? null : money(value - cost), pnlPct: value === null ? null : percent(value - cost, cost),
      annualDividend: dividend === null ? null : money(dividend), yieldOnCost: dividend === null ? null : percent(dividend, cost),
      currentYield: dividend === null || value === null ? null : percent(dividend, value),
      dividendGrowth: growth(lot.purchaseDps), yearDividendGrowth: growth(lot.priorYearDps) };
  });
  const valuationOverflow = valueSum > MAX_AMOUNT_UNITS;
  const valued = lots.length > 0 && missingQuotes === 0 && !valuationOverflow;
  const dividendsKnown = lots.length > 0 && missingDividends === 0;
  return { rows, totals: { cost: money(costSum), value: valued ? money(valueSum) : null,
    pnl: valued ? money(valueSum - costSum) : null, pnlPct: valued ? percent(valueSum - costSum, costSum) : null,
    annualDividend: dividendsKnown ? money(dividendSum) : null,
    yieldOnCost: dividendsKnown ? percent(dividendSum, costSum) : null, missingQuotes, missingDividends,
    ...(valuationOverflow ? { valuationOverflow: true } : {}) } };
}
