import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { resolvePageSessionPrincipal } from '@/auth/page-session';
import { getDatabase } from '@/db/client';
import { summarizeAssetEvidence, type AssetEvidence } from '@/asset-summary/domain';
import { createFullBalanceReportCheckpointRepository } from '@/import/sbi/full-balance-report-checkpoint-repository';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: '資産概要',
  robots: { index: false, follow: false },
};

function formatQuantity(value: string) {
  return value.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function formatDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return `${year}年${month}月${day}日時点`;
}

function SourceLocator({ page, row }: { page: number; row: number }) {
  return <span className="source-locator">原本位置: {page}ページ {row}行</span>;
}

function AccountEvidence({ evidence, accountName, headingId }: {
  evidence: AssetEvidence;
  accountName: string;
  headingId: string;
}) {
  const summary = summarizeAssetEvidence(evidence);
  const sectionStatuses = [
    ['deposits', '預り金', summary.deposits.rowCount],
    ['collateral', '担保・保証金', summary.collateral.rowCount],
    ['domesticStockLots', '国内株式', summary.stocks.rowCount],
    ['fundBalances', '投資信託', summary.funds.rowCount],
    ['margin', '信用建玉', summary.margin.rowCount],
    ['futures', '先物', 0],
    ['options', 'オプション', 0],
  ] as const;
  const sectionCount = (kind: keyof AssetEvidence['sections'], label: string, rowCount: number | null) =>
    evidence.sections[kind] === 'missing'
      ? `${label} 明細未入力`
      : `${label} ${rowCount ?? '利用不可'}件`;
  return (
    <section className="asset-account" aria-labelledby={headingId}>
      <header className="asset-account-header">
        <div>
          <h2 id={headingId}>{accountName}</h2>
          <p>{formatDate(evidence.statementDate)}</p>
        </div>
        <span className="evidence-badge">本人が内容を確認した報告書</span>
      </header>

      <div className="asset-section-totals" aria-label="報告書の区分別記載件数">
        <p><span>預り金</span><strong>{sectionCount('deposits', '預り金', summary.deposits.rowCount)}</strong></p>
        <p><span>担保・保証金</span><strong>{sectionCount('collateral', '担保・保証金', summary.collateral.rowCount)}</strong></p>
        <p><span>国内株式</span><strong>{sectionCount('domesticStockLots', '国内株式', summary.stocks.rowCount)}</strong></p>
        <p><span>投資信託</span><strong>{sectionCount('fundBalances', '投資信託', summary.funds.rowCount)}</strong></p>
        <p><span>信用建玉</span><strong>{sectionCount('margin', '信用建玉', summary.margin.rowCount)}</strong></p>
      </div>
      <ul className="section-state-list" aria-label="7区分の確認状態">
        {sectionStatuses.map(([kind, label, rowCount]) => (
          <li key={kind}>
            {label}: {evidence.sections[kind] === 'explicit_zero'
              ? '0件確認済み'
              : evidence.sections[kind] === 'missing'
                ? '残高あり・明細未入力'
                : `${rowCount ?? '利用不可'}件記載あり`}
          </li>
        ))}
      </ul>

      {summary.stocks.evaluation.state === 'incomplete' ? (
        <p className="asset-warning">
          国内株式は{summary.stocks.evaluation.missingCount}件の評価額が未記載です。
          評価額の記載ありは{summary.stocks.evaluation.reportedCount}件です。金額は合算していません。
        </p>
      ) : null}
      {summary.margin.openUnrealizedPnl.state === 'incomplete' ? (
        <p className="asset-warning">
          未決済の信用建玉は{summary.margin.openUnrealizedPnl.missingCount}件の評価損益が未記載です。
        </p>
      ) : null}

      <h3>預り金・担保</h3>
      <div className="import-table-wrap">
        <table className="import-table">
          <caption>預り金・担保の原本記載値</caption>
          <thead><tr><th>区分</th><th>報告書記載額</th><th>根拠</th></tr></thead>
          <tbody>
            {[...evidence.deposits, ...evidence.collateral].map((row) => (
              <tr key={`${row.sourcePage}:${row.sourceRow}`}>
                <td>{row.kind === 'cash_deposit' ? '預り金' : '担保・保証金'}</td>
                <td>報告書記載額 {row.amount}（通貨未確認）</td>
                <td><SourceLocator page={row.sourcePage} row={row.sourceRow} /></td>
              </tr>
            ))}
            {evidence.deposits.length + evidence.collateral.length === 0 ? (
              <tr><td colSpan={3}>{evidence.sections.deposits === 'missing' || evidence.sections.collateral === 'missing'
                ? '預り金・担保に明細未入力の区分があります。0件とは扱いません。'
                : '報告書では0件として確認済みです。'}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <h3>国内株式・投資信託</h3>
      <div className="import-table-wrap">
        <table className="import-table">
          <caption>国内株式・投資信託の原本記載値</caption>
          <thead><tr><th>種類</th><th>銘柄</th><th>数量・口数</th><th>報告書記載評価額</th><th>根拠</th></tr></thead>
          <tbody>
            {evidence.domesticStockLots.map((row) => (
              <tr key={`stock:${row.sourcePage}:${row.sourceRow}`}>
                <td>国内株式</td><td>{row.securityName}（{row.securityCode}）</td>
                <td>{formatQuantity(row.quantity)}</td>
                <td>{row.evaluationAmount === null ? '未記載' : `${row.evaluationAmount}（通貨未確認）`}</td>
                <td><SourceLocator page={row.sourcePage} row={row.sourceRow} /></td>
              </tr>
            ))}
            {evidence.fundBalances.map((row) => (
              <tr key={`fund:${row.sourcePage}:${row.sourceRow}`}>
                <td>投資信託</td><td>{row.securityName}（{row.securityCode}）</td>
                <td>{formatQuantity(row.units)}</td><td>{row.evaluationAmount}（通貨未確認）</td>
                <td><SourceLocator page={row.sourcePage} row={row.sourceRow} /></td>
              </tr>
            ))}
            {evidence.domesticStockLots.length + evidence.fundBalances.length === 0 ? (
              <tr><td colSpan={5}>{evidence.sections.domesticStockLots === 'missing' || evidence.sections.fundBalances === 'missing'
                ? '国内株式・投資信託に明細未入力の区分があります。0件とは扱いません。'
                : '報告書では0件として確認済みです。'}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <h3>信用建玉</h3>
      <div className="import-table-wrap">
        <table className="import-table">
          <caption>信用建玉の原本記載値</caption>
          <thead><tr><th>状態</th><th>売買</th><th>銘柄</th><th>数量</th><th>報告書記載評価損益</th><th>根拠</th></tr></thead>
          <tbody>
            {evidence.margin.map((row) => (
              <tr key={`margin:${row.sourcePage}:${row.sourceRow}`}>
                <td>{row.state === 'open' ? '未決済' : '決済済み'}</td>
                <td>{row.side === 'buy' ? '買建' : '売建'}</td>
                <td>{row.securityName}（{row.securityCode}）</td><td>{formatQuantity(row.quantity)}</td>
                <td>{row.unrealizedPnl === null ? '未記載' : `${row.unrealizedPnl}（通貨未確認）`}</td>
                <td><SourceLocator page={row.sourcePage} row={row.sourceRow} /></td>
              </tr>
            ))}
            {evidence.margin.length === 0 ? <tr><td colSpan={6}>{evidence.sections.margin === 'missing' ? '信用建玉の明細は未入力です。残高0とは扱いません。' : '報告書では0件として確認済みです。'}</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default async function AssetSummaryPage() {
  const principal = await resolvePageSessionPrincipal();
  if (!principal) return redirect('/login');
  const repository = createFullBalanceReportCheckpointRepository(getDatabase());
  const [evidence, readiness] = await Promise.all([
    repository.listLatestEvidence(principal),
    repository.getImportReadiness(principal),
  ]);

  return (
    <main className="import-shell">
      <section className="import-card asset-overview" aria-labelledby="asset-summary-title">
        <p className="preview-badge">ログイン済みの本人専用</p>
        <h1 id="asset-summary-title">資産概要</h1>
        <p className="asset-not-total">
          <strong>総資産はまだ計算していません</strong>
          預り金・担保・信用建玉の重複と通貨の誤認を避けるため、現段階では報告書記載値を区分別・未合算で表示します。
        </p>
        <section className="asset-readiness" aria-labelledby="import-readiness-title">
          <h2 id="import-readiness-title">取込・台帳の準備状況</h2>
          <div className="asset-section-totals" aria-label="取込状態の件数">
            <p><span>台帳</span><strong>台帳保存済み {readiness.ledgerEventCount}件</strong></p>
            <p><span>分配金</span><strong>分配金詳細待ち {readiness.unresolvedDistributionCount}件</strong></p>
            <p><span>要確認</span><strong>その他の要確認 {readiness.otherNeedsReviewCount}件</strong></p>
            <p><span>確定前</span><strong>確定前の取込 {readiness.previewReadyBatchCount}件</strong></p>
          </div>
          {readiness.unresolvedDistributionCount + readiness.otherNeedsReviewCount > 0 ? (
            <p className="asset-warning">要確認行は現在保有や損益へ反映していません。</p>
          ) : null}
        </section>
        {evidence.length === 0 ? (
          <div className="asset-empty">
            <h2>表示できる残高証拠がありません</h2>
            <p>SBI取引残高報告書を見ながら、基準日と各残高を確認して保存してください。</p>
            <Link className="balance-report-link" href="/imports/sbi/balance-report">残高報告書を確認する</Link>
          </div>
        ) : evidence.map((item, index) => (
          <AccountEvidence key={item.checkpointId} evidence={item}
            headingId={`asset-account-${index + 1}`}
            accountName={item.accountName} />
        ))}
        <nav className="asset-actions" aria-label="資産管理の操作">
          <Link href="/imports/sbi/balance-report">残高報告書を追加・確認</Link>
          <Link href="/imports/sbi">SBI取引履歴を取り込む</Link>
        </nav>
      </section>
    </main>
  );
}
