'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';

export function DistributionDetailsForm(props: {
  batchId: string;
  sourceRowNumber: number;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ordinaryDistributionConfirmed, setOrdinaryDistributionConfirmed] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ordinaryDistributionConfirmed) return;
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/imports/${props.batchId}/distribution-details`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceRowNumber: props.sourceRowNumber,
          distributionType: 'ordinary-distribution',
          reinvestmentDate: form.get('reinvestmentDate'),
          individualPrincipalPerTenThousand: form.get('individualPrincipalPerTenThousand'),
          reinvestmentAmountYen: form.get('reinvestmentAmountYen'),
          navPerTenThousand: form.get('navPerTenThousand'),
          reinvestmentQuantity: form.get('reinvestmentQuantity'),
          postReinvestmentBalance: form.get('postReinvestmentBalance'),
        }),
      });
      if (!response.ok) {
        let code = '';
        try {
          const body = await response.json() as { error?: { code?: string } };
          code = body.error?.code ?? '';
        } catch {
          // Only stable response codes influence the private UI.
        }
        if (code === 'detail_mismatch') {
          setError('CSVの数量・基準価額・日付と一致しません。入力内容を確認してください。');
        } else if (code === 'already_resolved') {
          setError('この行はすでに解決済みです。画面を更新してください。');
        } else if (code === 'session_expired') {
          setError('セッションが終了しました。再度ログインしてください。');
        } else {
          setError('保存できませんでした。入力内容を確認してください。');
        }
        return;
      }
      router.refresh();
    } catch {
      setError('保存できませんでした。通信状態を確認してください。');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} autoComplete="off">
      <fieldset disabled={pending}>
        <legend>分配金再投資の明細</legend>
        <p>分配区分: <strong>普通分配金</strong></p>
        <p>元本払戻金（特別分配金）と記載された通知書はこの入力を使わない。</p>
        <label>
          <input
            type="checkbox"
            checked={ordinaryDistributionConfirmed}
            onChange={(event) => setOrdinaryDistributionConfirmed(event.currentTarget.checked)}
          />
          通知書に「普通分配金」と記載されていることを確認しました
        </label>
        <label>再投資日<input name="reinvestmentDate" type="date" required autoComplete="off" /></label>
        <label>個別元本単価<input name="individualPrincipalPerTenThousand" inputMode="decimal" required maxLength={64} autoComplete="off" /></label>
        <label>再投資金額<input name="reinvestmentAmountYen" inputMode="numeric" required maxLength={64} autoComplete="off" /></label>
        <label>1万口あたり再投資の基準価額<input name="navPerTenThousand" inputMode="decimal" required maxLength={64} autoComplete="off" /></label>
        <label>再投資数量<input name="reinvestmentQuantity" inputMode="decimal" required maxLength={64} autoComplete="off" /></label>
        <label>再投資後の残高<input name="postReinvestmentBalance" inputMode="decimal" required maxLength={64} autoComplete="off" /></label>
        <button type="submit" disabled={pending || !ordinaryDistributionConfirmed}>
          {pending ? '保存中…' : '再投資詳細を保存'}
        </button>
      </fieldset>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}
