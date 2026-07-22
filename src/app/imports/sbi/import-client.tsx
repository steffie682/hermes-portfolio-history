'use client';

import Link from 'next/link';
import { useRef, useState, type ChangeEvent } from 'react';
import { buildSbiImportPreview, type SbiImportPreview } from '@/import/sbi/import-preview';
import { parseSbiTradeHistory } from '@/import/sbi/trade-history';
import { assessSbiCashTradeRows } from '@/import/sbi/cash-trade-event';
import { assessSbiDistributionReinvestments } from '@/import/sbi/distribution-reinvestment-event';

const MAX_FILE_BYTES = 10 * 1024 * 1024;

type Account = { id: string; broker: string; displayName: string };
type ServerPreview = {
  batchId: string;
  disposition: 'new' | 'duplicate';
  counts: { new: number; duplicate: number; needsReview: number; rejected: number };
};

function apiErrorCode(body: unknown) {
  if (!body || typeof body !== 'object') return null;
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function stageFailureMessage(code: string | null) {
  if (code === 'session_expired') return 'ログイン期限が切れました。再ログインしてからもう一度お試しください。';
  if (code === 'file_too_large') return 'CSVは10 MB以下のファイルを選んでください。';
  if (code === 'unsupported_file_type' || code === 'invalid_file') return 'SBIの約定履歴CSVを選び直してください。';
  if (code === 'invalid_account') return '保存先のSBI口座を選び直してください。';
  return '非公開保存サービスに接続できませんでした。時間をおいてもう一度お試しください。';
}

function commitFailureMessage(code: string | null) {
  if (code === 'session_expired') return 'ログイン期限が切れました。再ログインしてから確定してください。';
  if (code === 'invalid_import') return '保存済みの取込が見つかりません。CSVをもう一度保存して確認してください。';
  return '取込の確定に失敗しました。保存済みの内容は二重計上されないため、もう一度確定できます。';
}

function safeErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.startsWith('SBI約定履歴CSV')) {
    return error.message;
  }
  return 'CSVを確認できませんでした。SBIの約定履歴CSVを選び直してください。';
}

export default function SbiImportClient({ initialAccounts }: { initialAccounts: Account[] }) {
  const operationVersion = useRef(0);
  const initialSbiAccounts = initialAccounts.filter((account) => account.broker === 'sbi');
  const [accounts, setAccounts] = useState(initialSbiAccounts);
  const [selectedAccountId, setSelectedAccountId] = useState(initialSbiAccounts[0]?.id ?? '');
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [selectedBytes, setSelectedBytes] = useState<Uint8Array | null>(null);
  const [selectedMediaType, setSelectedMediaType] = useState('text/csv');
  const [preview, setPreview] = useState<SbiImportPreview | null>(null);
  const [cashAssessment, setCashAssessment] = useState<ReturnType<typeof assessSbiCashTradeRows> | null>(null);
  const [reinvestmentAssessment, setReinvestmentAssessment] = useState<ReturnType<typeof assessSbiDistributionReinvestments> | null>(null);
  const [serverPreview, setServerPreview] = useState<ServerPreview | null>(null);
  const [committedCount, setCommittedCount] = useState<number | null>(null);
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [staging, setStaging] = useState(false);
  const [committing, setCommitting] = useState(false);

  async function createFirstAccount() {
    if (creatingAccount || accounts.length > 0) return;
    setCreatingAccount(true);
    setError('');
    try {
      const response = await fetch('/api/broker-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broker: 'sbi', displayName: 'SBI証券' }),
      });
      const body = await response.json() as { account?: Account };
      if (!response.ok || !body.account) throw new Error('account-failed');
      setAccounts([body.account]);
      setSelectedAccountId(body.account.id);
      setStatus('SBI口座を登録しました');
    } catch {
      setError('SBI口座を登録できませんでした。時間をおいてもう一度お試しください。');
    } finally {
      setCreatingAccount(false);
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const version = ++operationVersion.current;
    const file = event.currentTarget.files?.[0];
    setSelectedBytes(null);
    setPreview(null);
    setCashAssessment(null);
    setReinvestmentAssessment(null);
    setServerPreview(null);
    setCommittedCount(null);
    setError('');
    setStatus('');
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setError('CSVは10 MB以下のファイルを選んでください。');
      return;
    }
    setStatus('CSVを確認しています…');
    try {
      const buffer = await file.arrayBuffer();
      if (version !== operationVersion.current) return;
      const bytes = new Uint8Array(buffer);
      const parsed = parseSbiTradeHistory(bytes);
      const nextPreview = buildSbiImportPreview(parsed.rows);
      const nextCashAssessment = assessSbiCashTradeRows(parsed.rows);
      const nextReinvestmentAssessment = assessSbiDistributionReinvestments(parsed.rows);
      if (version !== operationVersion.current) return;
      setSelectedBytes(bytes);
      setSelectedMediaType(file.type || 'text/csv');
      setPreview(nextPreview);
      setCashAssessment(nextCashAssessment);
      setReinvestmentAssessment(nextReinvestmentAssessment);
      setStatus(`取引 ${nextPreview.totalRows}件`);
    } catch (caught) {
      if (version !== operationVersion.current) return;
      setError(safeErrorMessage(caught));
      setStatus('');
    }
  }

  async function stageImport() {
    if (staging || committing || !selectedBytes || !selectedAccountId || !preview || preview.totalRows === 0) return;
    const version = operationVersion.current;
    setStaging(true);
    setError('');
    setStatus('本人専用の非公開領域へ保存しています…');
    try {
      const uploadBuffer = new ArrayBuffer(selectedBytes.byteLength);
      new Uint8Array(uploadBuffer).set(selectedBytes);
      const response = await fetch(
        '/api/imports/sbi',
        {
          method: 'POST',
          headers: {
            'Content-Type': selectedMediaType,
            'X-Broker-Account-Id': selectedAccountId,
          },
          body: uploadBuffer,
        },
      );
      const body = await response.json() as ServerPreview | { error?: { code?: string } };
      if (version !== operationVersion.current) return;
      if (!response.ok || !('batchId' in body)) throw new Error(apiErrorCode(body) ?? 'stage-failed');
      setServerPreview(body);
      setCommittedCount(null);
      setStatus(body.disposition === 'duplicate'
        ? '同じCSVはすでに保存済みです'
        : '非公開保存と取込前確認が完了しました');
    } catch (caught) {
      if (version !== operationVersion.current) return;
      setServerPreview(null);
      setError(stageFailureMessage(caught instanceof Error ? caught.message : null));
      setStatus('');
    } finally {
      if (version === operationVersion.current) setStaging(false);
    }
  }

  async function commitImport() {
    if (!serverPreview || serverPreview.counts.new === 0 || staging || committing || committedCount !== null) return;
    const batchId = serverPreview.batchId;
    setCommitting(true);
    setError('');
    try {
      const response = await fetch(`/api/imports/${batchId}/commit`, {
        method: 'POST',
      });
      const body = await response.json() as { batchId?: string; committed?: number; error?: { code?: string } };
      if (!response.ok || body.batchId !== batchId || typeof body.committed !== 'number') {
        throw new Error(apiErrorCode(body) ?? 'commit-failed');
      }
      setCommittedCount(body.committed);
      setStatus('取込を確定しました');
    } catch (caught) {
      setError(commitFailureMessage(caught instanceof Error ? caught.message : null));
    } finally {
      setCommitting(false);
    }
  }

  return (
    <>
      <div className="import-file-panel" aria-busy={staging || committing}>
        <label htmlFor="sbi-broker-account">保存先口座</label>
        <select
          id="sbi-broker-account"
          value={selectedAccountId}
          onChange={(event) => {
            setSelectedAccountId(event.currentTarget.value);
            setServerPreview(null);
            setCommittedCount(null);
          }}
          disabled={accounts.length === 0 || staging || committing}
        >
          {accounts.length === 0 ? <option value="">SBI口座がありません</option> : null}
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>{account.displayName}</option>
          ))}
        </select>
        {accounts.length === 0 ? (
          <div>
            <p role="alert">先にSBI口座を登録してください。</p>
            <button type="button" onClick={createFirstAccount} disabled={creatingAccount}>
              {creatingAccount ? '登録中…' : 'SBI口座を登録'}
            </button>
          </div>
        ) : null}
        <label htmlFor="sbi-trade-csv">SBI約定履歴CSV</label>
        <input id="sbi-trade-csv" type="file" accept=".csv,text/csv,application/vnd.ms-excel" onChange={handleFileChange} disabled={staging || committing} />
        <strong>CSV原本はログイン中の本人専用の非公開領域に保存されます</strong>
        <p>選択直後の形式確認はこのブラウザー内で行い、保存ボタンを押すまで送信しません。</p>
      </div>

      {status ? <p className="import-live-status" role="status">{status}</p> : null}
      {error ? <div className="import-error" role="alert">{error}</div> : null}

      {preview ? (
        <section className="actual-import-preview" aria-labelledby="actual-preview-title">
          <h2 id="actual-preview-title">分類結果</h2>
          <div className="import-summary" aria-label="取引の分類結果">
            <article className="summary-box summary-ready"><span>現物株・通常の投資信託</span><strong>自動計上候補 {preview.supportCounts.ready}件</strong></article>
            <article className="summary-box summary-waiting"><span>信用取引・現引</span><strong>信用対応待ち {preview.supportCounts['needs-margin-ledger']}件</strong></article>
            <article className="summary-box summary-waiting"><span>分配金再投資</span><strong>分配詳細待ち {preview.supportCounts['needs-distribution-details']}件</strong></article>
            <article className="summary-box summary-review"><span>新しい取引種類</span><strong>種類の確認待ち {preview.supportCounts['needs-review']}件</strong></article>
          </div>
          {cashAssessment && cashAssessment.cashCandidateRows > 0 ? (
            <div className="cash-readiness" aria-label="現物・投信の台帳準備">
              <strong>{`現物・投信の台帳準備 ${cashAssessment.readyRows} / ${cashAssessment.cashCandidateRows}件`}</strong>
              {cashAssessment.needsReviewRows > 0 ? <p>{`金額確認が必要な行 ${cashAssessment.needsReviewRows}件`}</p> : null}
              {cashAssessment.requiresOpeningCheckpoint ? <p>開始時点の保有残高が必要です</p> : null}
            </div>
          ) : null}
          {reinvestmentAssessment && reinvestmentAssessment.candidateRows > 0 ? (
            <div className="distribution-readiness" aria-label="分配金再投資の準備">
              <strong>{`再投資口数の準備 ${reinvestmentAssessment.unitsReadyRows} / ${reinvestmentAssessment.candidateRows}件`}</strong>
              {reinvestmentAssessment.needsReviewRows > 0 ? <p>{`口数確認が必要な行 ${reinvestmentAssessment.needsReviewRows}件`}</p> : null}
              {reinvestmentAssessment.requiresDistributionDetails ? <p>分配金・税・取得価額の詳細が必要です</p> : null}
            </div>
          ) : null}
          {preview.totalRows === 0 ? (
            <div className="import-warning" role="alert"><strong>CSVに取引がありません</strong><p>期間を確認して、取引を含むSBI約定履歴CSVを選んでください。</p></div>
          ) : preview.hasDeferredRows ? (
            <div className="import-warning" role="alert"><strong>未反映の取引が {preview.deferredRows}件あります</strong><p>対応が完成するまで、総資産を確定表示しません。</p></div>
          ) : <p className="import-ready-message">すべて自動計上候補として確認できました。</p>}
          {reinvestmentAssessment?.requiresDistributionDetails ? (
            <Link className="balance-report-link" href="/imports/sbi/distribution-report">分配金・再投資PDFの構造を確認する</Link>
          ) : null}
          {preview.supportCounts['needs-margin-ledger'] > 0 ? <Link className="balance-report-link" href="/imports/sbi/balance-report">取引残高報告書を確認する</Link> : null}
          <button
            className="import-confirm"
            type="button"
            onClick={stageImport}
            disabled={staging || committing || !selectedBytes || !selectedAccountId || preview.totalRows === 0}
          >{staging ? '保存中…' : '非公開で保存して確認'}</button>

          {serverPreview ? (
            <div className="import-summary" aria-label="保存後の取込確認">
              <article className="summary-box summary-ready"><strong>新規 {serverPreview.counts.new}件</strong></article>
              <article className="summary-box summary-waiting"><strong>重複 {serverPreview.counts.duplicate}件</strong></article>
              <article className="summary-box summary-review"><strong>要確認 {serverPreview.counts.needsReview}件</strong></article>
              <article className="summary-box summary-review"><strong>拒否 {serverPreview.counts.rejected}件</strong></article>
            </div>
          ) : null}
          {serverPreview ? (
            <Link className="balance-report-link" href={`/imports/sbi/${serverPreview.batchId}`}>
              原本行との対応を確認
            </Link>
          ) : null}
          <button
            className="import-confirm"
            type="button"
            onClick={commitImport}
            disabled={!serverPreview || serverPreview.counts.new === 0 || staging || committing || committedCount !== null}
          >{committing ? '確定中…' : '取込を確定'}</button>
          {committedCount !== null ? <p className="import-ready-message">確定済み {committedCount}件</p> : null}
        </section>
      ) : null}
    </>
  );
}
