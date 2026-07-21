# PostgreSQL roles

Use separate credentials for schema migration and the running application.

- `DATABASE_MIGRATION_URL`: owns the application schema and applies migration files.
- `DATABASE_URL`: used by the Next.js runtime. It must be `NOSUPERUSER`, `NOBYPASSRLS`, and must not own tenant tables.

Example outline (replace role names and set passwords through the deployment secret manager, never in Git):

```sql
CREATE ROLE portfolio_migrator LOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE portfolio_app LOGIN NOSUPERUSER NOBYPASSRLS;
GRANT CONNECT ON DATABASE portfolio_history TO portfolio_app;
GRANT USAGE ON SCHEMA public TO portfolio_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "user", auth_sessions, passkey_credentials, auth_challenges, broker_accounts,
  private_source_objects, source_documents, import_batches, source_records,
  staged_events, ledger_events
  TO portfolio_app;
GRANT SELECT, INSERT, DELETE ON device_enrollment_grants TO portfolio_app;
REVOKE ALL ON
  "user", auth_sessions, passkey_credentials, auth_challenges,
  device_enrollment_grants, broker_accounts, private_source_objects,
  source_documents, import_batches, source_records, staged_events, ledger_events
  FROM PUBLIC;
```

Run migrations as `portfolio_migrator`, then re-apply the runtime grants when migrations add tables. The application performs a startup check against `pg_roles` and refuses a runtime role with `rolsuper` or `rolbypassrls`. `broker_accounts`, `private_source_objects`, `source_documents`, `import_batches`, `source_records`, `staged_events`, and `ledger_events` use RLS and `FORCE ROW LEVEL SECURITY`; tenant queries set `app.current_user_id` transaction-locally from an opaque session-derived principal. Owner-inclusive composite foreign keys enforce tenant-consistent parent references independently of RLS. `private_source_objects` is the durable inventory for private Blob uploads. Automatic reconciliation retries only `cleanup_pending`; it never deletes a `pending_upload` merely because it is old, avoiding a race with a slow upload. Old `pending_upload` rows require operator investigation. Related broker-account and user deletion is blocked with `RESTRICT` until Blob cleanup and inventory removal complete.

Production CI should exercise migrations and tenant-isolation tests against a real PostgreSQL service in addition to the fast PGlite tests.
