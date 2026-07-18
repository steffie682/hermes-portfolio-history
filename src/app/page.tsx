import Link from 'next/link';
import { getProjectStatus } from '@/lib/project-status';

export default function HomePage() {
  const status = getProjectStatus();
  return (
    <main className="shell">
      <section className="panel" aria-labelledby="page-title">
        <p className="eyebrow">hermes-portfolio-history</p>
        <h1 id="page-title">資産履歴管理</h1>
        <p className="status">基盤を構築中です</p>
        <p className="description">
          現在は安全な取込・台帳・ユーザー分離のための基盤を実装しています。
          利用可能な金融機能はまだありません。
        </p>
        <dl>
          <div><dt>開発段階</dt><dd>{status.stage}</dd></div>
          <div><dt>実装済み機能</dt><dd>{status.implementedFeatures.length}件</dd></div>
        </dl>
        <Link className="login-link" href="/login">
          ログイン・利用開始
        </Link>
      </section>
    </main>
  );
}
