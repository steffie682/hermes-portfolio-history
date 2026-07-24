'use client';

import { useRef, useState, type FormEvent } from 'react';

export type BalanceReportAccountSummary = { id: string; displayName: string };
export type SavedSnapshotSummary = {
  id: string;
  brokerAccountId: string;
  statementDate: string;
  status: string;
  positionCount: number;
  createdAt: string | Date;
};
type PositionDraft = {
  sourcePage: string; side: 'buy' | 'sell'; securityCode: string; securityName: string;
  quantity: string; unitPriceYen: string; openedOn: string; dueOn: string;
};

const emptyPosition = (): PositionDraft => ({
  sourcePage: '1', side: 'buy', securityCode: '', securityName: '',
  quantity: '', unitPriceYen: '', openedOn: '', dueOn: '',
});

export default function BalanceReportPositionForm({
  accounts,
}: {
  accounts: BalanceReportAccountSummary[];
}) {
  const [brokerAccountId, setBrokerAccountId] = useState(accounts[0]?.id ?? '');
  const [statementDate, setStatementDate] = useState('');
  const [positions, setPositions] = useState<PositionDraft[]>([emptyPosition()]);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmedNoPositions, setConfirmedNoPositions] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveInFlight = useRef(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [savedSnapshot, setSavedSnapshot] = useState<SavedSnapshotSummary | null>(null);

  function updatePosition(index: number, field: keyof PositionDraft, value: string) {
    setPositions((current) => current.map((position, positionIndex) =>
      positionIndex === index ? { ...position, [field]: value } : position));
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saveInFlight.current || !confirmed || !brokerAccountId) return;
    saveInFlight.current = true;
    setSaving(true);
    setSaveMessage('');
    try {
      const response = await fetch('/api/imports/sbi/balance-report-snapshots', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          brokerAccountId,
          statementDate,
          confirmedFromOriginal: true,
          confirmedNoPositions,
          positions: confirmedNoPositions ? [] : positions.map((position) => ({
            sourcePage: Number(position.sourcePage),
            side: position.side,
            securityCode: position.securityCode,
            securityName: position.securityName,
            quantity: position.quantity,
            unitPriceYen: position.unitPriceYen,
            openedOn: position.openedOn,
            dueOn: position.dueOn || null,
          })),
        }),
      });
      const result = await response.json() as {
        snapshot?: SavedSnapshotSummary;
        error?: { code?: string };
      };
      if (!response.ok || !result.snapshot) {
        const messages: Record<string, string> = {
          session_expired: 'セッションが切れました。再ログインしてください。',
          invalid_origin: '安全確認に失敗しました。ページを再読み込みしてください。',
          invalid_account: '選択したSBI口座を確認できませんでした。',
          invalid_snapshot: '入力内容を確認してください。',
          snapshot_unavailable: '現在保存できません。時間をおいてもう一度お試しください。',
        };
        setSaveMessage(messages[result.error?.code ?? ''] ?? '保存できませんでした。');
        return;
      }
      setSavedSnapshot(result.snapshot);
      setSaveMessage(response.status === 200
        ? '同じ確認内容はすでに保存されています。'
        : '本人確認した信用建玉を保存しました。');
    } catch {
      setSaveMessage('保存できませんでした。通信状態を確認してください。');
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <section className="safe-report-result" aria-labelledby="confirmed-positions-title">
      <h2 id="confirmed-positions-title">次の手順：信用建玉を本人確認して保存</h2>
      <p>
        報告書基準日時点で取引残高報告書に表示された信用建玉を、
        残高報告書チェックポイントとして保存します。
      </p>
      <p>
        将来の手動CSV照合では、開始側または終了側の証拠として選べます。
        この保存は取込バッチへ自動リンクせず、信用台帳イベントを計上せず、
        CSVを照合せず、資産残高を完成させません。
      </p>
      <p>
        元の取引残高報告書を目で確認し、信用建玉を手入力してください。
        OCRや構造レポートから値を推測しないでください。
      </p>
      <p>JSONは任意の診断用であり、保存ワークフローの出力ではありません。</p>
      <form onSubmit={(event) => void handleSave(event)}>
        <fieldset disabled={saving}>
          <label htmlFor="snapshot-account">SBI口座</label>
          <select id="snapshot-account" value={brokerAccountId}
            onChange={(event) => setBrokerAccountId(event.currentTarget.value)}>
            {accounts.map((account) => <option key={account.id} value={account.id}>{account.displayName}</option>)}
          </select>
          <label htmlFor="snapshot-date">報告書基準日</label>
          <input id="snapshot-date" type="date" required value={statementDate}
            onChange={(event) => setStatementDate(event.currentTarget.value)} />
          <label>
            <input type="checkbox" checked={confirmedNoPositions}
              onChange={(event) => setConfirmedNoPositions(event.currentTarget.checked)} />
            報告書で信用建玉が0件であることを確認した
          </label>
          {!confirmedNoPositions ? positions.map((position, index) => (
            <fieldset key={index}>
              <legend>信用建玉 {index + 1}</legend>
              <label htmlFor={`position-page-${index}`}>元PDFのページ</label>
              <input id={`position-page-${index}`} type="number" min="1" max="100" required
                value={position.sourcePage}
                onChange={(event) => updatePosition(index, 'sourcePage', event.currentTarget.value)} />
              <label htmlFor={`position-side-${index}`}>売買</label>
              <select id={`position-side-${index}`} value={position.side}
                onChange={(event) => updatePosition(index, 'side', event.currentTarget.value)}>
                <option value="buy">買</option><option value="sell">売</option>
              </select>
              <label htmlFor={`position-code-${index}`}>銘柄コード</label>
              <input id={`position-code-${index}`} required pattern="[A-Z0-9]{4}" maxLength={4}
                value={position.securityCode}
                onChange={(event) => updatePosition(index, 'securityCode', event.currentTarget.value)} />
              <label htmlFor={`position-name-${index}`}>銘柄名</label>
              <input id={`position-name-${index}`} required maxLength={100} value={position.securityName}
                onChange={(event) => updatePosition(index, 'securityName', event.currentTarget.value)} />
              <label htmlFor={`position-quantity-${index}`}>数量</label>
              <input id={`position-quantity-${index}`} required inputMode="numeric" maxLength={18}
                value={position.quantity}
                onChange={(event) => updatePosition(index, 'quantity', event.currentTarget.value)} />
              <label htmlFor={`position-price-${index}`}>単価（円）</label>
              <input id={`position-price-${index}`} required inputMode="decimal"
                value={position.unitPriceYen}
                onChange={(event) => updatePosition(index, 'unitPriceYen', event.currentTarget.value)} />
              <label htmlFor={`position-opened-${index}`}>建日</label>
              <input id={`position-opened-${index}`} type="date" required value={position.openedOn}
                onChange={(event) => updatePosition(index, 'openedOn', event.currentTarget.value)} />
              <label htmlFor={`position-due-${index}`}>期日（任意）</label>
              <input id={`position-due-${index}`} type="date" value={position.dueOn}
                onChange={(event) => updatePosition(index, 'dueOn', event.currentTarget.value)} />
              {positions.length > 1 ? (
                <button type="button" onClick={() =>
                  setPositions((current) => current.filter((_, positionIndex) => positionIndex !== index))}>
                  この建玉を削除
                </button>
              ) : null}
            </fieldset>
          )) : null}
          {!confirmedNoPositions && positions.length < 100 ? (
            <button type="button" onClick={() => setPositions((current) => [...current, emptyPosition()])}>
              建玉を追加
            </button>
          ) : null}
          <label>
            <input type="checkbox" checked={confirmed}
              onChange={(event) => setConfirmed(event.currentTarget.checked)} />
            入力値は元の取引残高報告書を読んで確認し、OCRから推測していません
          </label>
          <button type="submit" disabled={!confirmed || saving}>確認した建玉を保存</button>
        </fieldset>
      </form>
      {saveMessage ? <p role="status">{saveMessage}</p> : null}
      {savedSnapshot ? (
        <p>
          保存内容：{savedSnapshot.statementDate}・{savedSnapshot.positionCount}件
        </p>
      ) : null}
    </section>
  );
}
