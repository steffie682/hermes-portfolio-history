export const MAX_DISTRIBUTION_DETAILS_BYTES = 8 * 1024;

const KEYS = [
  'sourceRowNumber',
  'distributionType',
  'reinvestmentDate',
  'individualPrincipalPerTenThousand',
  'reinvestmentAmountYen',
  'navPerTenThousand',
  'reinvestmentQuantity',
  'postReinvestmentBalance',
] as const;

export interface DistributionReinvestmentDetails {
  sourceRowNumber: number;
  distributionType: 'ordinary-distribution';
  reinvestmentDate: string;
  individualPrincipalPerTenThousand: string;
  reinvestmentAmountYen: string;
  navPerTenThousand: string;
  reinvestmentQuantity: string;
  postReinvestmentBalance: string;
}

function invalid(): never {
  throw new Error('invalid-distribution-details');
}

function canonicalDecimal(value: unknown, integerOnly = false): string {
  if (typeof value !== 'string' || value.length > 64) invalid();
  if (/[\u0000-\u001f\u007f-\u009f]|\p{Bidi_Control}/u.test(value)) invalid();
  const trimmed = value.trim();
  const pattern = integerOnly
    ? /^(?:\d+|\d{1,3}(?:,\d{3})+)$/
    : /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/;
  if (!pattern.test(trimmed)) invalid();
  const [rawInteger, rawFraction = ''] = trimmed.replaceAll(',', '').split('.');
  const normalizedInteger = rawInteger.replace(/^0+(?=\d)/, '');
  const normalizedFraction = rawFraction.replace(/0+$/, '');
  const canonical = normalizedFraction
    ? `${normalizedInteger}.${normalizedFraction}`
    : normalizedInteger;
  if (!/[1-9]/.test(canonical) || canonical.length > 64) invalid();
  return canonical;
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 64) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() === Number(match[2]) - 1
    && date.getUTCDate() === Number(match[3]);
}

export function compareCanonicalDecimals(left: string, right: string): -1 | 0 | 1 {
  const normalize = (value: string) => {
    const [integer, fraction = ''] = value.split('.');
    return {
      integer: integer.replace(/^0+(?=\d)/, ''),
      fraction: fraction.replace(/0+$/, ''),
    };
  };
  const a = normalize(left);
  const b = normalize(right);
  if (a.integer.length !== b.integer.length) return a.integer.length < b.integer.length ? -1 : 1;
  if (a.integer !== b.integer) return a.integer < b.integer ? -1 : 1;
  const width = Math.max(a.fraction.length, b.fraction.length);
  const af = a.fraction.padEnd(width, '0');
  const bf = b.fraction.padEnd(width, '0');
  return af === bf ? 0 : af < bf ? -1 : 1;
}

export function parseDistributionReinvestmentDetails(
  input: unknown,
): DistributionReinvestmentDetails {
  let serialized: string;
  try {
    serialized = JSON.stringify(input);
  } catch {
    return invalid();
  }
  if (new TextEncoder().encode(serialized).byteLength > MAX_DISTRIBUTION_DETAILS_BYTES) invalid();
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid();
  const value = input as Record<string, unknown>;
  const actualKeys = Object.keys(value).sort();
  if (actualKeys.length !== KEYS.length
    || actualKeys.some((key, index) => key !== [...KEYS].sort()[index])) invalid();
  if (!Number.isSafeInteger(value.sourceRowNumber) || (value.sourceRowNumber as number) <= 0) invalid();
  if (value.distributionType !== 'ordinary-distribution') invalid();
  if (!validDate(value.reinvestmentDate)) invalid();

  const result: DistributionReinvestmentDetails = {
    sourceRowNumber: value.sourceRowNumber as number,
    distributionType: 'ordinary-distribution',
    reinvestmentDate: value.reinvestmentDate,
    individualPrincipalPerTenThousand: canonicalDecimal(value.individualPrincipalPerTenThousand),
    reinvestmentAmountYen: canonicalDecimal(value.reinvestmentAmountYen, true),
    navPerTenThousand: canonicalDecimal(value.navPerTenThousand),
    reinvestmentQuantity: canonicalDecimal(value.reinvestmentQuantity),
    postReinvestmentBalance: canonicalDecimal(value.postReinvestmentBalance),
  };
  if (compareCanonicalDecimals(
    result.postReinvestmentBalance,
    result.reinvestmentQuantity,
  ) < 0) invalid();
  return result;
}
