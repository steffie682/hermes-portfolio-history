# hermes-portfolio-history

SBI証券の帳票を本人専用で取り込み、表示値から元の行まで追跡できる資産履歴サービスです。

## 現在の状態

**SBI取込・残高証拠の確認版です。アプリ全体は未完成です。**

実装済み:

- Passkey（WebAuthn）認証と期限付きhash session
- PostgreSQL RLSとアプリ側owner条件による利用者分離
- SBI口座登録、CSVのブラウザー内preview、明示操作後のprivate staging
- 原本hashと経済event fingerprintによる重複防止
- 原本・取込batch・元行・段階event・append-only台帳の追跡
- 分配金再投資の通知書を見ながら行う追加情報確認
- SBI取引残高報告書の端末内確認と、本人確認した残高checkpoint保存
- 端末内OCRで完全に読めた国内株・投信だけを候補入力（原本照合とページ・行番号の本人入力は必須）
- 残高はあるが明細が多い区分を、0と偽らず「明細未入力」の未解決証拠として保存
- `/portfolio`で最新checkpointの預り金・担保・国内株式・投信・信用建玉を区分別表示
- 評価額欠損時のfail-closed表示と、原本ページ・行への追跡情報

未実装:

- 預り金・担保・信用建玉の会計関係を確定した総資産
- 純入金、運用損益、日次資産推移、残高自動照合
- 配当の税引前後集計、月年別推移、YOC
- 市場価格・為替、TWR/XIRR、benchmark、他社証券
- 全データexport

## 重要な表示境界

`/portfolio`は、本人が残高報告書を見て確認した原本記載値を行ごとに表示します。保存形式に通貨列がないため通貨を断定せず、区分内・区分間とも金額を合算しません。評価額の記載あり／欠損は件数で表示します。残高checkpointはCSV取込batchを自動照合・解決しません。

## 設計上の約束

- 複数ユーザーのデータを厳密に分離する
- 金額・数量・利回りは決定論的コードで計算する
- AIだけで金融数値を確定しない
- 表示数値から原本の取込行まで追跡できるようにする
- SBIのログイン情報を保存しない
- 実データ、原本帳票、token、log、sessionをGitへ保存しない
- 未実装機能を実装済みとして表示しない

詳細は [`docs/INITIAL_DESIGN.md`](docs/INITIAL_DESIGN.md) を参照してください。

## ローカル設定

`.env.example`を参考に、runtime用`DATABASE_URL`、migration用`DATABASE_MIGRATION_URL`、32文字以上の`AUTH_SECRET`、`WEBAUTHN_ORIGIN`、`WEBAUTHN_RP_ID`を設定します。Passkeyは本番ではHTTPSが必要です（`localhost`のみHTTP利用可）。session tokenとchallenge照合tokenはHttpOnly cookieに保持し、DBにはhashだけを保存します。

PostgreSQL roleの分離と最小権限設定は [`docs/DATABASE_ROLES.md`](docs/DATABASE_ROLES.md) を参照してください。
