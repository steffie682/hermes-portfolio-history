import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="shell">
      <section className="panel" aria-labelledby="page-title">
        <p className="eyebrow">hermes-portfolio-history</p>
        <h1 id="page-title">資産履歴管理</h1>
        <p className="status">個別株の保有記録・SBI残高証拠</p>
        <p className="description">
          「株の庭」で、登録した個別株の含み損益・予想普通配当・増配率を確認できます。
          SBI証券の取引履歴と残高報告書は別の記録として本人専用で保存します。
          口座全体の総資産・税務損益・受取済み配当の集計はまだ未実装です。
        </p>
        <dl>
          <div><dt>現在できること</dt><dd>個別株の手入力管理・株価確認・CSV取込・残高証拠</dd></div>
          <div><dt>記録の範囲</dt><dd>株の庭とSBIの台帳は自動連携しません</dd></div>
          <div><dt>データ保護</dt><dd>本人専用・非公開</dd></div>
        </dl>
        <div className="home-actions">
          <Link className="login-link" href="/garden">株の庭を開く</Link>
          <Link className="secondary-link" href="/garden/preview">サンプル画面を見る</Link>
          <Link className="secondary-link" href="/portfolio">資産概要を見る</Link>
          <Link className="secondary-link" href="/login">ログイン・利用開始</Link>
        </div>
      </section>
    </main>
  );
}
