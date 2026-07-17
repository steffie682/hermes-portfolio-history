# Security Policy

## Sensitive data

このリポジトリへ以下をcommitしないでください。

- SBIを含む金融サービスのID、password、token、cookie、session
- ユーザーのCSV、PDF、取引履歴、残高、口座番号、氏名
- application log、database dump、object-storage data、backup
- `.env`、秘密鍵、実credentialを含む設定

サンプル帳票は匿名化だけでなく、元の取引情報を復元できない合成fixtureとして作成します。

## Reporting

脆弱性やデータ漏洩の可能性は公開Issueへ金融データを添付せず、リポジトリ所有者へ非公開で連絡してください。


## Authentication boundaries

- Passkey ceremonyではRP ID、origin、challenge、user verificationを検証します。
- session tokenとchallenge照合tokenは平文でDBへ保存せず、SHA-256 hashのみ保存します。
- 認証cookieはHttpOnly、SameSite=Strictとし、HTTPS環境ではSecureを必須にします。
- tenant-owned tableはPostgreSQL RLSと`FORCE ROW LEVEL SECURITY`で所有者境界を強制します。
- application接続roleをsuperuserまたは`BYPASSRLS`にしてはいけません。migration roleとapplication roleを分離し、最小権限で運用します。
- 認証失敗時にcredential、challenge、token、内部例外をresponseやapplication logへ出しません。
- アカウント削除要求時は全sessionを即時失効し、削除要求済みユーザーのPasskey認証を拒否します。

- 公開環境ではPasskey options／verify endpointへ分散rate limitを設定します。applicationはchallenge発行時に期限切れ行を削除します。
- `auth_sessions`、`passkey_credentials`、`auth_challenges`はtenant業務データではなく、認証serviceだけが扱うcontrol-plane tableです。一般のtenant API roleへ直接公開しません。
