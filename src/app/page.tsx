import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="shell">
      <section className="panel" aria-labelledby="page-title">
        <p className="eyebrow">hermes-portfolio-history</p>
        <h1 id="page-title">資産履歴管理</h1>
        <p className="status">SBI取込・残高証拠の確認版</p>
        <p className="description">
          SBI証券の取引履歴と残高報告書を本人専用で保存し、元の行まで追跡できます。
          総資産・運用損益・配当集計はまだ未実装です。
        </p>
        <dl>
          <div><dt>現在できること</dt><dd>CSV取込・台帳保存・残高証拠の区分表示</dd></div>
          <div><dt>未実装</dt><dd>総資産・損益・配当・YOC</dd></div>
          <div><dt>データ保護</dt><dd>本人専用・非公開</dd></div>
        </dl>
        <div className="home-actions">
          <Link className="login-link" href="/portfolio">資産概要を見る</Link>
          <Link className="secondary-link" href="/login">ログイン・利用開始</Link>
        </div>
      </section>
    </main>
  );
}
