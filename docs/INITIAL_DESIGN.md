# 資産履歴管理サービス 初期設計

## 目的
任意のユーザーがSBI証券由来のCSV・PDFを投入し、資産・損益・配当履歴を安全に確認できるWebサービスを作る。表示数値から計算式、台帳イベント、取込行、原本まで追跡可能にする。

## 技術構成
- Next.js + TypeScriptのモジュラーモノリス
- PostgreSQL + Drizzle ORM + Row Level Security（RLS）
- 金融計算はPostgreSQL NUMERICとdecimal.js
- 原本は非公開S3互換ストレージ
- Vitest + Playwright
- 必要時のみ隔離Python PDF workerを追加

## 設計原則
1. 全ユーザー所有データにowner_user_idを持たせ、ユーザー間を厳密に分離する。
2. AIは未知帳票の分類・抽出候補・説明生成だけに使い、金額・数量・利回りは決定論的コードで計算する。
3. 原本は不変に保存し、解析結果・台帳・集計値は再生成可能にする。
4. 各データにconfirmed / estimated / needs_reviewを持たせる。
5. 原本hashとイベントfingerprintで重複取込を防ぐ。
6. SBIログイン情報は保存せず、初期版はファイル投入方式にする。
7. 指標の定義と計算バージョンを保存・表示する。
8. ユーザー自身による全データ出力と完全削除を提供する。
9. 未実装機能を実装済みとして表示しない。

## SBI公式情報から確認した制約
- 通常の約定履歴は過去2年間。
- 2年超は取引報告書・取引残高報告書を参照する。
- 電子交付書類は原則5年間閲覧でき、PDF保存可能。
- 書面請求では最大過去10年間を取得できる場合がある。
- 請求対象には取引報告書、取引残高報告書、年間取引報告書、配当等の支払通知書、顧客勘定元帳等がある。

CSV列、文字コード、商品別差、PDFレイアウト、取得価額・訂正取引の表現は実サンプルで確認する。パーサーはbroker + document_type + layout_version単位のアダプター方式にする。

## システム構成
Browserは認証、アップロード、取込レビュー、ダッシュボード、元データ追跡を担当する。Next.jsアプリ内をAuth、Import、Ledger、Portfolio Calculation、Reporting、Export/Deleteに分離する。PostgreSQLに台帳と集計を、非公開Object Storageに暗号化原本を保存する。

## 主要データモデル
### 認証・口座
- users
- broker_accounts（SBI認証情報は持たない）
- account_tax_wrappers（特定、一般、旧NISA、新NISA各枠）

### 取込・追跡
- source_documents: SHA-256、MIME、サイズ、保存先、帳票種別、状態
- import_batches: パーサー名・版、件数、エラー
- source_records: ページ・表・行、原文、変換前フィールド、fingerprint
- staged_events: 確定前候補、検証エラー、ユーザー修正
- import_issues: 未対応形式、残高不一致、未知銘柄、重複候補

### 正規化台帳
- instruments
- ledger_events: 所有者、口座、日時、種別、通貨、状態、元レコード
- trades: 売買、数量、単価、受渡額、手数料、税
- cash_movements: 入出金、振替
- income_events: 配当、税引前、国内税、外国税、税引後
- fx_events、corporate_actions
- position_checkpoints、cash_checkpoints
- manual_adjustments: 根拠・作成者・日時必須。元データは上書きしない

### 計算・監査
- market_prices、fx_rates
- calculation_runs
- daily_portfolio_snapshots、daily_position_snapshots
- metric_values: TWR、XIRR、配当、YOCと定義版
- audit_events: 取込、修正、削除、出力。秘密値や原文全体は記録しない

## インポート処理
状態遷移：uploaded -> scanned -> classified -> parsed -> validated -> preview_ready -> committed -> reconciled -> calculated。失敗時はneeds_review / unsupported / rejected。

1. MIME、magic bytes、サイズを検証する。
2. 所有者別の非公開領域へ暗号化保存する。
3. SHA-256で同一原本を検出する。
4. 既知ルールで帳票分類し、未知時だけAIを候補分類に使う。
5. ページ・表・行番号を保持して解析する。
6. 日付、通貨、数量、税、口座、銘柄を型付き候補へ正規化する。
7. 口座、種別、日時、銘柄、数量、金額、通貨、参照番号からfingerprintを作る。
8. 完全一致は重複、訂正・取消・表記揺れは要確認にする。
9. 税引前から税を引いた値と税引後の一致、数量と単価と代金、残高チェックポイントを検証する。
10. 確定前プレビュー後、DBトランザクションで原子的に確定する。
11. 再構築残高と報告書チェックポイントを照合する。

AI出力だけで金額・数量を確定しない。外部AIへ原本を送る場合は、明示同意、マスキング、送信先・保持方針の表示を必須にする。

## 計算定義
- 総資産 = 各保有数量と価格と基準通貨FXの積の合計 + 通貨別現金の基準通貨換算額
- 純入金累計 = 外部入金累計 - 外部出金累計
- 累積運用損益 = 総資産 - 純入金累計 - 初期資産調整
- 現在保有YOC = 予想年間配当 / 現在保有分の簿価
- 実績YOC = 対象期間の税引前配当 / 期間中の平均投下簿価
- TWR = 各サブ期間の1足す収益率を連鎖した値から1を引く

内部値は丸めず表示時だけ丸める。価格欠損時の直近値はestimatedにする。実現損益はSBI確定値を優先し、自前値は版付き参考値にする。配当は税引前・国内税・外国税・税引後を分ける。予想と実績を混ぜない。XIRRが非収束・複数解候補なら値を出さず理由を表示する。

## マルチユーザー・セキュリティ
1. 認証はmagic linkまたはPasskeyを第一候補にする。
2. API入力のuser_idを信用せず、認証セッションから所有者を決める。
3. 全所有テーブルにPostgreSQL RLSを適用する。
4. アプリ所有者条件とDB RLSの両方をテストする。
5. 原本は非公開にし、短寿命署名URLだけ発行する。
6. PDF workerをCPU・メモリ・ネットワーク制限する。
7. CSV出力時に数式注入を無害化する。
8. 口座番号、氏名、明細、原本、tokenをログへ出さない。
9. DB、原本、派生物、cacheの削除とbackup失効期間を明示する。
10. 初期版に共有機能は入れない。

## MVP画面
/login、/onboarding、/imports、/imports/:id/review、/dashboard、/portfolio、/dividends、/ledger、/settings/data。

## 実装フェーズ
0. 匿名化した保有一覧、約定、入出金、配当、残高報告書の実サンプル確認。
1. 認証・RLS・1種類のCSV取込・重複防止・元行追跡・クロステナントE2E。
2. チェックポイント、日次ポジション、総資産・純入金・運用損益、残高照合。
3. 配当取込、税引前後、月年別推移、現在保有YOCと実績YOC。
4. PDFアダプター、layout version、要確認UI、過去復元。
5. TWR/XIRR、価格・為替、ベンチマーク、配当予測、他社証券。

## テスト戦略
RED、GREEN、REFACTORで縦に実装する。匿名化実帳票fixture、重複投入の冪等性、金融計算golden test、残高照合、tenant isolation、完全削除、原子的取込、登録から削除までのE2Eを必須にする。

## ユーザーを呼ぶ場面
1. 実際のSBIファイル形式が必要になった時。
2. 最初の画面試作を確認する時。
3. SBI表示値と計算結果に差が出た時。
4. 公開形態を決める時。
5. 外部AIへ原本を送る可能性が生じた時。

## 初回リリース受入条件
- 2人以上が別アカウントで利用でき、相互アクセス不能テストが通る。
- ファイルをプレビュー後に確定でき、再投入でも二重計上されない。
- 数値から原本行まで辿れる。
- 総資産、純入金、運用損益、配当、YOCのgolden testが通る。
- 不明・欠損・推定値を正確と表示しない。
- ユーザー自身で全データを出力・削除できる。

## 主要リスクと対策
- SBI帳票変更：アダプターとlayout version、匿名化fixture、未知形式の安全な拒否で対応する。
- 過去履歴欠損：残高チェックポイントと初期残高を使い、推定値と確認済み値を分ける。
- 税務簿価との差：SBI確定値を優先し、自前計算は版と根拠を持つ参考値にする。
- PDF誤読：合計照合、信頼度、要確認フローを必須にし、AIだけで確定しない。
- ユーザー間漏洩：RLS、アプリ認可、クロステナントE2E、非公開原本で二重防御する。
- 市場データ：利用前に保存・再配布ライセンスを確認する。

## 未決事項
- CSV/PDFの実レイアウトと商品・年度ごとの差。
- 初回公開形態（ローカル、招待制、一般公開）。
- 株価・為替・予想配当データの取得元と利用条件。
- 外部AI解析を提供するか、ローカル解析だけにするか。
- バックアップ保持期間と削除完了までの最大期間。

## 公式情報源
- https://faq.sbisec.co.jp/answer/5eba63cc171ba70012b8feb0/
- https://faq.sbisec.co.jp/answer/5eba698b1149dd0011cbefa2/
- https://faq.sbisec.co.jp/answer/5ebb974c9fdfce001137be8f/

## 結論
初期実装はAI資産管理ではなく、証券帳票を安全に正規化する追跡可能な金融台帳として作る。その上に資産推移、配当、YOC、高度な分析を積む。
