import { createHash } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
const ROOT_KEYS = [
  'brokerAccountId', 'confirmedFromOriginal', 'confirmedNoPositions',
  'positions', 'statementDate',
];
const POSITION_KEYS = [
  'dueOn', 'openedOn', 'quantity', 'securityCode', 'securityName',
  'side', 'sourcePage', 'unitPriceYen',
];

export type CanonicalBalanceReportPosition = {
  sourcePage: number;
  side: 'buy' | 'sell';
  securityCode: string;
  securityName: string;
  quantity: string;
  unitPriceYen: string;
  openedOn: string;
  dueOn: string | null;
};

export type CanonicalBalanceReportSnapshot = {
  brokerAccountId: string;
  statementDate: string;
  positions: CanonicalBalanceReportPosition[];
  confirmedFromOriginal?: never;
  confirmedNoPositions?: never;
};

export class BalanceReportSnapshotValidationError extends Error {
  constructor() {
    super('invalid_snapshot');
  }
}

function invalid(): never {
  throw new BalanceReportSnapshotValidationError();
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]) {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DATE.exec(value);
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

function canonicalPositiveInteger(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{1,18}$/.test(value)) invalid();
  const canonical = value.replace(/^0+/, '') || '0';
  if (canonical === '0') invalid();
  return canonical;
}

function canonicalPositiveDecimal(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{1,18}(?:\.\d{1,6})?$/.test(value)) invalid();
  const [wholeInput, fractionInput] = value.split('.');
  const whole = wholeInput.replace(/^0+/, '') || '0';
  const fraction = fractionInput?.replace(/0+$/, '') ?? '';
  const canonical = fraction ? `${whole}.${fraction}` : whole;
  if (/^0(?:\.0*)?$/.test(canonical)) invalid();
  return canonical;
}

export function canonicalizeBalanceReportSnapshot(
  input: unknown,
): CanonicalBalanceReportSnapshot {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid();
  const root = input as Record<string, unknown>;
  if (!hasExactKeys(root, ROOT_KEYS)) invalid();
  if (
    typeof root.brokerAccountId !== 'string'
    || !UUID.test(root.brokerAccountId)
    || !validDate(root.statementDate)
    || root.confirmedFromOriginal !== true
    || typeof root.confirmedNoPositions !== 'boolean'
    || !Array.isArray(root.positions)
    || root.positions.length > 100
  ) invalid();
  if ((root.positions.length === 0) !== root.confirmedNoPositions) invalid();
  const statementDate = root.statementDate;

  const positions = root.positions.map((value): CanonicalBalanceReportPosition => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
    const position = value as Record<string, unknown>;
    if (!hasExactKeys(position, POSITION_KEYS)) invalid();
    if (
      !Number.isInteger(position.sourcePage)
      || (position.sourcePage as number) < 1
      || (position.sourcePage as number) > 100
      || (position.side !== 'buy' && position.side !== 'sell')
      || typeof position.securityCode !== 'string'
      || !/^[A-Z0-9]{4}$/.test(position.securityCode)
      || typeof position.securityName !== 'string'
      || !validDate(position.openedOn)
      || !(position.dueOn === null || validDate(position.dueOn))
    ) invalid();
    if (UNSAFE_TEXT.test(position.securityName)) invalid();
    const securityName = position.securityName.trim();
    if (
      securityName.length < 1
      || [...securityName].length > 100
      || (position.dueOn !== null && position.dueOn < position.openedOn)
      || position.openedOn > statementDate
      || (position.dueOn !== null && position.dueOn < statementDate)
    ) invalid();
    return {
      sourcePage: position.sourcePage as number,
      side: position.side,
      securityCode: position.securityCode,
      securityName,
      quantity: canonicalPositiveInteger(position.quantity),
      unitPriceYen: canonicalPositiveDecimal(position.unitPriceYen),
      openedOn: position.openedOn,
      dueOn: position.dueOn,
    };
  });
  if (new Set(positions.map((position) => JSON.stringify(position))).size !== positions.length) {
    invalid();
  }

  return {
    brokerAccountId: root.brokerAccountId.toLowerCase(),
    statementDate,
    positions,
  };
}

export function fingerprintBalanceReportSnapshot(
  ownerUserId: string,
  snapshot: CanonicalBalanceReportSnapshot,
) {
  return createHash('sha256').update(JSON.stringify({
    version: 1,
    ownerUserId,
    brokerAccountId: snapshot.brokerAccountId,
    statementDate: snapshot.statementDate,
    positions: snapshot.positions,
  })).digest('hex');
}
