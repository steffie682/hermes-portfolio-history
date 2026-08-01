# PostgreSQL roles

Schema migrationと実行中アプリでは別credentialを使います。

- `DATABASE_MIGRATION_URL`: application schemaを所有し、migrationを適用するrole
- `DATABASE_URL`: Next.js runtime用。`NOSUPERUSER`、`NOBYPASSRLS`、tenant tableの非ownerを必須とする

## Bootstrapで付与する権限

passwordはGitへ書かず、deployment secret managerで設定します。初期bootstrapは接続とschema利用までに留めます。

```sql
CREATE ROLE portfolio_migrator LOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE portfolio_app LOGIN NOSUPERUSER NOBYPASSRLS;
GRANT CONNECT ON DATABASE portfolio_history TO portfolio_app;
GRANT USAGE ON SCHEMA public TO portfolio_app;
```

## Table権限の正本

Tableごとの`GRANT`と`REVOKE`は、手作業の一括SQLではなく`drizzle/*/migration.sql`を正本とします。新しいtable追加時はmigration credentialでmigrationを適用してください。過去の広い権限が残る場合があるため、append-only tableではmigrationが明示的に広域権限を`REVOKE`した後、必要な`SELECT, INSERT`だけを再付与します。

特に`ledger_events`、残高snapshot/checkpointとその子tableはappend-onlyです。runtime roleに`UPDATE`または`DELETE`を付与してはいけません。schema宣言だけで既存権限は狭まらないため、適用済み環境では最新のforward migrationまで実行し、`has_table_privilege`を使う実PostgreSQL integration testで確認します。

`broker_accounts`、private import chain、ledger、残高証拠tableはRLSと`FORCE ROW LEVEL SECURITY`を使います。tenant queryはsession由来のopaque principalを`app.current_user_id`へtransaction-localに設定します。ownerを含むcomposite foreign keyで、同一owner内の別口座・別batchを混ぜる攻撃も拒否します。

`private_source_objects`はprivate Blobのdurable inventoryです。自動reconciliationは`cleanup_pending`だけを再試行し、古いという理由だけで`pending_upload`を削除しません。Blob inventoryが残る間は関連口座・userの削除を`RESTRICT`します。

CIではPGliteだけでなく、PostgreSQL service上でmigration、RLS、runtime ACL、append-only拒否を実行し、対象testがskipされていないことをlogで確認します。
