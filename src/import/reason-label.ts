const labels: Readonly<Record<string, string>> = {
  'missing-transaction-type': '取引種類が空欄です',
  'missing-security-name': '銘柄名が空欄です',
  'unsupported-transaction-type': '未対応の取引種類です',
  'invalid-quantity': '数量を確認してください',
  'invalid-unit-price': '単価を確認してください',
  'missing-settlement-amount': '受渡金額を確認してください',
};

export function importReasonLabel(reasonCode: string | null) {
  if (!reasonCode) return null;
  return labels[reasonCode] ?? '自動判定できないため確認が必要です';
}
