import { createHash } from 'node:crypto';

const ROOT_KEYS = [
  'brokerAccountId', 'collateral', 'deposits', 'domesticStockLots', 'evidence',
  'fundBalances', 'futures', 'margin', 'options',
  'sourcePageCount', 'statementDate', 'allRelevantPagesReviewed',
];
const SECTION_KEYS = ['evidenceState', 'rows', 'zeroLocator'];
const EVIDENCE_KEYS = ['confirmation', 'kind'];
const SECTION_NAMES = [
  'deposits', 'collateral', 'domesticStockLots', 'fundBalances', 'margin',
] as const;
const ALL_SECTION_NAMES = [...SECTION_NAMES, 'futures', 'options'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SECURITY_CODE = /^(?:[0-9][0-9A-HJ-NP-UW-Y][0-9][0-9A-HJ-NP-UW-Y]|[0-9]{3}\.[0-9]{2})$/;
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
const UNPAIRED_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
const ROW_KEYS = {
  deposits: ['amount', 'kind', 'sourcePage', 'sourceRow'],
  collateral: ['amount', 'kind', 'sourcePage', 'sourceRow'],
  domesticStockLots: [
    'acquisitionDate', 'acquisitionUnitPrice', 'acquisitionUnitPriceState', 'evaluationAmount',
    'purchaseAmount', 'purchaseAmountState', 'quantity', 'referencePrice', 'rowKind',
    'securityCode', 'securityName', 'sourcePage', 'sourceRow',
  ],
  fundBalances: [
    'evaluationAmount', 'referencePrice', 'referencePriceUnit', 'securityCode',
    'securityName', 'sourcePage', 'sourceRow', 'units',
  ],
  margin: [
    'contractDate', 'contractUnitPrice', 'currentPrice', 'fees',
    'designationLabel', 'finalSettlementOrPlannedDate', 'market', 'quantity',
    'repaymentTermLabel', 'securityCode', 'securityName', 'side', 'sourcePage', 'sourceRow',
    'state', 'unrealizedPnl',
  ],
} satisfies Record<(typeof SECTION_NAMES)[number], string[]>;

export type SourceLocator = { sourcePage: number; sourceRow: number };

export type FullBalanceReportCheckpoint = {
  brokerAccountId: string;
  statementDate: string;
  sourcePageCount: number;
  allRelevantPagesReviewed: true;
  evidence: { kind: 'generic_as_of'; confirmation: 'manual' };
  deposits: {
    evidenceState: 'explicit_zero' | 'reported' | 'missing'; zeroLocator: SourceLocator | null;
    rows: Array<SourceLocator & { kind: 'cash_deposit'; amount: string }>;
  };
  collateral: {
    evidenceState: 'explicit_zero' | 'reported' | 'missing'; zeroLocator: SourceLocator | null;
    rows: Array<SourceLocator & {
      kind: 'margin_guarantee' | 'stock_lending_collateral' | 'futures_options_margin';
      amount: string;
    }>;
  };
  domesticStockLots: {
    evidenceState: 'explicit_zero' | 'reported' | 'missing'; zeroLocator: SourceLocator | null;
    rows: Array<SourceLocator & {
      securityCode: string;
      securityName: string;
      rowKind: 'acquisition_lot';
      acquisitionDate: string;
      quantity: string;
      acquisitionUnitPriceState: 'reported' | 'masked' | 'absent';
      purchaseAmountState: 'reported' | 'masked' | 'absent';
      acquisitionUnitPrice: string | null;
      purchaseAmount: string | null;
      referencePrice: string | null;
      evaluationAmount: string | null;
    }>;
  };
  fundBalances: {
    evidenceState: 'explicit_zero' | 'reported' | 'missing'; zeroLocator: SourceLocator | null;
    rows: Array<SourceLocator & {
      securityCode: string;
      securityName: string;
      units: string;
      referencePrice: string;
      evaluationAmount: string;
      referencePriceUnit: string | null;
    }>;
  };
  margin: {
    evidenceState: 'explicit_zero' | 'reported' | 'missing'; zeroLocator: SourceLocator | null;
    rows: Array<SourceLocator & {
      state: 'open' | 'settled';
      securityCode: string;
      securityName: string;
      repaymentTermLabel: string;
      designationLabel: string | null;
      quantity: string;
      market: 'tokyo' | 'private' | 'nagoya' | 'fukuoka' | 'sapporo';
      side: 'buy' | 'sell';
      contractDate: string;
      contractUnitPrice: string;
      currentPrice: string | null;
      fees: string | null;
      unrealizedPnl: string | null;
      finalSettlementOrPlannedDate: string;
    }>;
  };
  futures: { evidenceState: 'explicit_zero'; zeroLocator: SourceLocator; rows: [] };
  options: { evidenceState: 'explicit_zero'; zeroLocator: SourceLocator; rows: [] };
};

export class FullBalanceReportCheckpointValidationError extends Error {
  constructor() {
    super('invalid_full_balance_report_checkpoint');
  }
}

function invalid(): never {
  throw new FullBalanceReportCheckpointValidationError();
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1
    && date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function safeText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string'
    && value === value.trim()
    && value.length > 0
    && [...value].length <= maxLength
    && !UNSAFE_TEXT.test(value)
    && !UNPAIRED_SURROGATE.test(value);
}

function decimal(
  value: unknown,
  options: { scale: number; positive?: boolean; signed?: boolean },
): value is string {
  if (typeof value !== 'string') return false;
  const sign = options.signed ? '-?' : '';
  const pattern = new RegExp(`^${sign}(?:0|[1-9]\\d{0,17})(?:\\.\\d{1,${options.scale}})?$`);
  if (!pattern.test(value) || (value.includes('.') && value.endsWith('0')) || value === '-0') {
    return false;
  }
  return !options.positive || !/^0(?:\.0*)?$/.test(value);
}

function locator(row: Record<string, unknown>, sourcePageCount: number) {
  return Number.isInteger(row.sourcePage)
    && (row.sourcePage as number) >= 1
    && (row.sourcePage as number) <= sourcePageCount
    && Number.isInteger(row.sourceRow)
    && (row.sourceRow as number) >= 1
    && (row.sourceRow as number) <= 100;
}

function nullable(value: unknown, validate: (candidate: unknown) => boolean) {
  return value === null || validate(value);
}

function validateRow(
  name: (typeof SECTION_NAMES)[number],
  value: unknown,
  statementDate: string,
  sourcePageCount: number,
) {
  if (!record(value) || !exactKeys(value, ROW_KEYS[name]) || !locator(value, sourcePageCount)) invalid();
  if (name === 'deposits') {
    if (
      value.kind !== 'cash_deposit'
      || !decimal(value.amount, { scale: 2, positive: true })
    ) invalid();
  } else if (name === 'collateral') {
    if (
      !['margin_guarantee', 'stock_lending_collateral', 'futures_options_margin'].includes(value.kind as string)
      || !decimal(value.amount, { scale: 2, positive: true })
    ) invalid();
  } else if (name === 'domesticStockLots') {
    if (
      typeof value.securityCode !== 'string' || !SECURITY_CODE.test(value.securityCode)
      || !safeText(value.securityName, 100)
      || value.rowKind !== 'acquisition_lot'
      || !validDate(value.acquisitionDate)
      || !decimal(value.quantity, { scale: 6, positive: true })
      || !validValueState(value.acquisitionUnitPriceState, value.acquisitionUnitPrice,
        (item) => decimal(item, { scale: 6, positive: true }))
      || !validValueState(value.purchaseAmountState, value.purchaseAmount,
        (item) => decimal(item, { scale: 2, positive: true }))
      || !nullable(value.referencePrice, (item) => decimal(item, { scale: 6, positive: true }))
      || !nullable(value.evaluationAmount, (item) => decimal(item, { scale: 2, positive: true }))
      || value.acquisitionDate > statementDate
    ) invalid();
  } else if (name === 'fundBalances') {
    if (
      typeof value.securityCode !== 'string' || !SECURITY_CODE.test(value.securityCode)
      || !safeText(value.securityName, 100)
      || !decimal(value.units, { scale: 6, positive: true })
      || !decimal(value.referencePrice, { scale: 6, positive: true })
      || !decimal(value.evaluationAmount, { scale: 2, positive: true })
      || !nullable(value.referencePriceUnit, (item) => decimal(item, { scale: 6, positive: true }))
    ) invalid();
  } else if (
    !['open', 'settled'].includes(value.state as string)
    || typeof value.securityCode !== 'string' || !SECURITY_CODE.test(value.securityCode)
    || !safeText(value.securityName, 100)
    || !safeText(value.repaymentTermLabel, 50)
    || !nullable(value.designationLabel, (item) => safeText(item, 50))
    || !['tokyo', 'private', 'nagoya', 'fukuoka', 'sapporo'].includes(value.market as string)
    || (value.side !== 'buy' && value.side !== 'sell')
    || !validDate(value.contractDate)
    || !decimal(value.quantity, { scale: 6, positive: true })
    || !decimal(value.contractUnitPrice, { scale: 6, positive: true })
    || !nullable(value.currentPrice, (item) => decimal(item, { scale: 6, positive: true }))
    || !nullable(value.fees, (item) => decimal(item, { scale: 2 }))
    || !nullable(value.unrealizedPnl, (item) => decimal(item, { scale: 2, signed: true }))
    || !validDate(value.finalSettlementOrPlannedDate)
  ) invalid();
  if (name === 'margin') {
    const contractDate = value.contractDate as string;
    if (contractDate > statementDate) invalid();
    const finalDate = value.finalSettlementOrPlannedDate as string;
    if (finalDate < contractDate) invalid();
  }
}

function validValueState(
  state: unknown,
  value: unknown,
  validate: (candidate: unknown) => boolean,
) {
  return state === 'reported' ? validate(value)
    : (state === 'masked' || state === 'absent') && value === null;
}

export function validateFullBalanceReportCheckpoint(
  input: unknown,
): FullBalanceReportCheckpoint {
  if (!record(input) || !exactKeys(input, ROOT_KEYS)) invalid();
  if (
    typeof input.brokerAccountId !== 'string'
    || !UUID.test(input.brokerAccountId)
    || !validDate(input.statementDate)
    || !Number.isInteger(input.sourcePageCount)
    || (input.sourcePageCount as number) < 1
    || (input.sourcePageCount as number) > 100
    || input.allRelevantPagesReviewed !== true
    || !record(input.evidence)
    || !exactKeys(input.evidence, EVIDENCE_KEYS)
    || input.evidence.kind !== 'generic_as_of'
    || input.evidence.confirmation !== 'manual'
  ) invalid();
  const locators = new Set<string>();
  const addLocator = (value: Record<string, unknown>) => {
    if (!locator(value, input.sourcePageCount as number)) invalid();
    const key = `${value.sourcePage}:${value.sourceRow}`;
    if (locators.has(key)) invalid();
    locators.add(key);
  };
  for (const name of ALL_SECTION_NAMES) {
    const section = input[name];
    if (
      !record(section)
      || !exactKeys(section, SECTION_KEYS)
      || !Array.isArray(section.rows)
      || section.rows.length > 100
    ) invalid();
    const zero = section.evidenceState === 'explicit_zero';
    const missing = section.evidenceState === 'missing';
    if (
      (zero && (section.rows.length !== 0 || !record(section.zeroLocator)))
      || (missing && (section.rows.length !== 0 || section.zeroLocator !== null))
      || (!zero && !missing && (section.evidenceState !== 'reported' || section.rows.length === 0
        || section.zeroLocator !== null))
      || ((name === 'futures' || name === 'options') && !zero)
    ) invalid();
    if (zero) addLocator(section.zeroLocator as Record<string, unknown>);
    for (const row of section.rows) {
      if (name === 'futures' || name === 'options') invalid();
      validateRow(name, row, input.statementDate, input.sourcePageCount as number);
      addLocator(row as Record<string, unknown>);
    }
  }
  return input as FullBalanceReportCheckpoint;
}

export function fingerprintFullBalanceReportCheckpoint(
  ownerUserId: string,
  checkpoint: FullBalanceReportCheckpoint,
) {
  return createHash('sha256').update(canonicalJson({
    version: 2,
    ownerUserId,
    checkpoint,
  })).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (record(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
