'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

function errorCode(body: unknown) {
  if (!body || typeof body !== 'object') return '';
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return '';
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : '';
}

function commitFailureMessage(code: string) {
  if (code === 'session_expired') return 'ログイン期限が切れました。再ログインしてから確定してください。';
  if (code === 'invalid_import') return '保存済みの取込が見つかりません。SBI CSV取込から作業を確認してください。';
  if (code === 'distribution_details_required') return '分配金・再投資の詳細を保存してから確定してください。';
  if (code === 'commit_unavailable' || code === 'service_unavailable') {
    return '確定サービスを一時的に利用できません。保存済みの内容は残っているため、時間をおいてもう一度お試しください。';
  }
  return '取込の確定に失敗しました。保存済みの内容は二重計上されないため、もう一度確定できます。';
}

export function BatchCommitButton({ batchId }: { batchId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [committed, setCommitted] = useState<number | null>(null);
  const [error, setError] = useState('');

  async function commit() {
    if (pending || committed !== null) return;
    setPending(true);
    setError('');
    try {
      const response = await fetch(`/api/imports/${batchId}/commit`, { method: 'POST' });
      const body = await response.json() as { batchId?: string; committed?: number; error?: unknown };
      if (!response.ok || body.batchId !== batchId || typeof body.committed !== 'number') {
        setError(commitFailureMessage(errorCode(body)));
        return;
      }
      setCommitted(body.committed);
      router.refresh();
    } catch {
      setError('確定できませんでした。通信状態を確認して、もう一度お試しください。');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="import-workflow-actions">
      <button className="import-confirm" type="button" disabled={pending || committed !== null} onClick={() => void commit()}>
        {pending ? '確定中…' : '取込を確定'}
      </button>
      {committed !== null ? <p className="import-ready-message" role="status">確定済み {committed}件</p> : null}
      {error ? <p className="import-error" role="alert">{error}</p> : null}
    </div>
  );
}
