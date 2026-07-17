# hermes-portfolio-history

SBI証券などの証券帳票から、追跡可能な資産履歴台帳を構築するためのプロジェクトです。

## 現在の状態

**開発基盤とPasskey認証・PostgreSQL RLSによるユーザー分離を実装中です。資産取込・計算などの金融機能はまだ実装されていません。**

現時点の成果物：

- Next.js + TypeScriptの最小アプリケーション
- PostgreSQL / Drizzleのschemaとmigration
- Passkey（WebAuthn）によるpasswordless認証
- PostgreSQL RLSによるユーザー所有データの強制分離
- hash保存session、期限付きchallenge、アカウント削除要求の土台
- Vitest、ESLint、TypeScript、production buildの品質ゲート
- GitHub Actions CI
- `docs/INITIAL_DESIGN.md` — 初期アーキテクチャ、データモデル、計算定義、実装フェーズ
- GitHub Issues — 実装ロードマップと受入条件

## 設計上の約束

- 複数ユーザーのデータを厳密に分離する
- 金額・数量・利回りは決定論的コードで計算する
- AIだけで金融数値を確定しない
- 表示数値から原本の取込行まで追跡できるようにする
- SBIのログイン情報を保存しない
- 実データ、原本帳票、token、log、sessionをGitへ保存しない

## 開発方針

実装はIssue単位の短いfeature branchで進め、テスト通過後に`main`へ統合します。切り戻し単位は原則としてマージコミットまたはリリースタグとします。

詳細は [`docs/INITIAL_DESIGN.md`](docs/INITIAL_DESIGN.md) を参照してください。


## 認証のローカル設定

`.env.example`を参考に、runtime用`DATABASE_URL`、migration用`DATABASE_MIGRATION_URL`、32文字以上の`AUTH_SECRET`、`WEBAUTHN_ORIGIN`、`WEBAUTHN_RP_ID`をローカル環境へ設定します。Passkeyは本番ではHTTPSが必要です（`localhost`のみHTTP利用可）。session tokenとchallenge照合tokenはHttpOnly cookieに保持し、DBにはhashだけを保存します。


PostgreSQL roleの分離と最小権限設定は [`docs/DATABASE_ROLES.md`](docs/DATABASE_ROLES.md) を参照してください。
