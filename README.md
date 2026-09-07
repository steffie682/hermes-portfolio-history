# hermes-portfolio-history

SBI証券の帳票を本人専用で取り込み、表示値から元の行まで追跡できる資産履歴サービスです。

## 現在の状態

**SBI取込・残高証拠と、手入力の個別株モニターです。アプリ全体は未完成です。**

### 株の庭（今回の追加）

`/garden` は既存Passkeyで保護された本人専用の保有記録です。現在保有する国内株式の株数・取得単価・購入日・口座区分・普通配当・出典・購入メモを手入力し、終値と含み損益、予想普通配当、取得利回り、取得後・前年比増配率を表示します。買い増しは別ロットとして記録できます。SBI台帳・仮想PFからは自動転記しません。

価格は画面を開くとき／更新操作時に決定論的コードで取得します。取引時間中の未確定当日バーは除外します。価格取得・計算にLLMは使用しません。常駐の日次履歴保存・自動IR監査・実受取配当・過去資産曲線は未実装です。配当は本人入力の会社予想で、取得日・確認日・価格日を分離します。欠損はゼロにせず全体合計を未確認とします。

`/garden/preview` は架空の4銘柄だけを使う公開可能なデザインサンプルで、入力・保存やprivate API呼出しはありません。

リリースには `garden_states` の追加migrationが先に必要です。既存のprotected production migration workflowを通し、成功確認前にschema-dependent featureをproductionへmergeしません。実際の配布状態はPR・migration run・deploymentの検証記録を参照してください。

既存SBI取込の実装済み:

- Passkey（WebAuthn）認証と期限付きhash session
- PostgreSQL RLSとアプリ側owner条件による利用者分離
- SBI口座登録、CSVのブラウザー内preview、明示操作後のprivate staging
- 原本hashと経済event fingerprintによる重複防止
- 原本・取込batch・元行・段階event・append-only台帳の追跡
- 分配金再投資の通知書を見ながら行う追加情報確認
- SBI取引残高報告書の端末内確認と、本人確認した残高checkpoint保存
- 端末内OCRで厳格な構造条件に一致した国内株・投信・信用建玉を未確認候補として入力（信用建玉の元PDFページはPDF.jsの処理ページ番号から自動入力して本人が原本照合し、行番号は本人入力必須。国内株・投信のページ・行番号は本人入力必須）
- 氏名・住所・口座番号の3見出しを高信頼で検出できたページは、該当行を端末内canvasへ全幅maskして再OCR（外部共有用の匿名PDF生成ではない）
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
