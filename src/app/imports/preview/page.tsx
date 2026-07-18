import type { Metadata } from 'next';
import { buildSbiImportPreview } from '@/import/sbi/import-preview';

export const metadata: Metadata = {
  title: 'CSV取込の確認（画面見本）',
  robots: { index: false, follow: false },
};

const syntheticRows = [
  '株式現物買', '株式現物売', '現引', '信用新規買', '信用新規売', '信用返済買',
  '信用返済売', '投信金額解約', '投信金額買付', '投信金額買付(募集)', '分配金再投資',
].map((transactionType, index) => ({ sourceRowNumber: index + 1, transactionType }));

const supportCopy = {
  ready: { label: '自動計上候補', detail: '現物株・通常の投資信託', tone: 'ready' },
  'needs-margin-ledger': { label: '信用対応待ち', detail: '信用取引・現引', tone: 'waiting' },
  'needs-distribution-details': { label: '分配詳細待ち', detail: '分配金再投資', tone: 'waiting' },
  'needs-review': { label: '種類の確認待ち', detail: '未知の取引', tone: 'review' },
} as const;

export default function ImportPreviewPage() {
  const preview = buildSbiImportPreview(syntheticRows);
  const summaries = Object.entries(supportCopy).map(([support, copy]) => ({
    ...copy,
    count: preview.supportCounts[support as keyof typeof preview.supportCounts],
  }));

  return (
    <main className="import-shell">
      <section className="import-card" aria-labelledby="import-title">
        <header className="import-header">
          <p className="preview-badge">画面見本（合成データ）</p>
          <h1 id="import-title">CSV取込の確認</h1>
          <p>読み取った取引を、計算できるものと対応待ちに分けて確認します。</p>
        </header>

        <div className="import-summary" aria-label="取引の分類結果">
          {summaries.map(({ label, detail, tone, count }) => (
            <article className={`summary-box summary-${tone}`} key={label}>
              <span>{detail}</span>
              <strong>{label} {count}件</strong>
            </article>
          ))}
        </div>

        <div className="import-warning" role="alert">
          <strong>未反映の取引があります</strong>
          <p>信用取引・現引・分配金再投資の処理が完成するまで、総資産を確定表示しません。</p>
        </div>

        <section aria-labelledby="classification-title">
          <h2 id="classification-title">取引種類ごとの扱い</h2>
          <div className="import-table-wrap">
            <table className="import-table">
              <thead><tr><th scope="col">取引種類</th><th scope="col">現在の扱い</th></tr></thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.transactionType}>
                    <td>{row.transactionType}</td>
                    <td>{supportCopy[row.support].label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <p className="preview-note">この画面は合成した取引名だけを使った見本です。実際のCSVは読み込みません。</p>
        <button className="import-confirm" type="button" disabled>取込を確定（まだ利用できません）</button>
      </section>
    </main>
  );
}
