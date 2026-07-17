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
