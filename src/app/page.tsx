import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="shell">
      <section className="panel" aria-labelledby="page-title">
        <p className="eyebrow">hermes-portfolio-history</p>
        <h1 id="page-title">資産履歴管理</h1>
        <p className="status">本番環境で利用できます</p>
        <p className="description">
          SBI証券の取引履歴を安全に取り込み、資産台帳と分配金・再投資明細を管理できます。
          データはログインした本人だけが閲覧できます。
        </p>
        <dl>
          <div><dt>主な機能</dt><dd>CSV取込・資産台帳・分配金明細</dd></div>
          <div><dt>データ保護</dt><dd>本人専用・非公開</dd></div>
        </dl>
        <Link className="login-link" href="/login">
          ログイン・利用開始
        </Link>
      </section>
    </main>
  );
}
