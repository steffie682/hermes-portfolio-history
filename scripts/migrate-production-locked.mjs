import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { pathToFileURL } from 'node:url';

const PRODUCTION_MIGRATION_LOCK = 731_084_284;

export async function validateMigrationTree(migrationsFolder) {
  const requestedRoot = path.resolve(migrationsFolder);
  const rootStat = await lstat(requestedRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Invalid migration tree.');
  const canonicalRoot = await realpath(requestedRoot);
  if (canonicalRoot !== requestedRoot) throw new Error('Invalid migration tree.');
  const directories = await readdir(canonicalRoot, { withFileTypes: true });
  if (directories.length === 0) throw new Error('Invalid migration tree.');
  for (const directory of directories) {
    if (!directory.isDirectory() || directory.isSymbolicLink()
      || !/^\d{14}_[a-z0-9_]+$/.test(directory.name)) throw new Error('Invalid migration tree.');
    const migrationDirectory = path.join(canonicalRoot, directory.name);
    const files = await readdir(migrationDirectory, { withFileTypes: true });
    if (files.map((file) => file.name).sort().join(',') !== 'migration.sql,snapshot.json') {
      throw new Error('Invalid migration tree.');
    }
    for (const file of files) {
      if (!file.isFile() || file.isSymbolicLink()) throw new Error('Invalid migration tree.');
      const filePath = path.join(migrationDirectory, file.name);
      const fileStat = await lstat(filePath);
      const canonicalFile = await realpath(filePath);
      if (!fileStat.isFile() || fileStat.isSymbolicLink()
        || !canonicalFile.startsWith(`${canonicalRoot}${path.sep}`)) throw new Error('Invalid migration tree.');
    }
  }
  return canonicalRoot;
}

const PRODUCTION_MIGRATION_STAGES = new Set([
  'configuration', 'validation', 'connection', 'lock', 'migration', 'unlock', 'release', 'close', 'unknown',
]);

function safeStage(stage) {
  return typeof stage === 'string' && PRODUCTION_MIGRATION_STAGES.has(stage) ? stage : 'unknown';
}

function safeSqlState(value) {
  const code = String(value ?? '');
  return /^[0-9A-Z]{5}$/.test(code) ? code : 'unknown';
}

const PRODUCTION_MIGRATION_REASONS = new Set([
  'configuration_missing', 'migration_history_mismatch', 'migration_table_upgrade_missing',
  'driver_transaction_unsupported', 'postgres_error', 'unknown',
]);

function safeReason(reason) {
  return typeof reason === 'string' && PRODUCTION_MIGRATION_REASONS.has(reason) ? reason : 'unknown';
}

function classifyReason(error, sqlState) {
  if (sqlState !== 'unknown') return 'postgres_error';
  const seen = new Set();
  let current = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (!current || typeof current !== 'object' || seen.has(current)) return 'unknown';
    seen.add(current);
    try {
      const message = 'message' in current ? String(current.message) : '';
      if (message.startsWith('While upgrading your database migrations table we found ')
        && message.endsWith(' migrations were applied to the database but are missing from the local environment')) {
        return 'migration_history_mismatch';
      }
      if (message.startsWith('No upgrade path from migration table version ')) {
        return 'migration_table_upgrade_missing';
      }
      if (/^(this\.client|client)\.begin is not a function$/.test(message)) {
        return 'driver_transaction_unsupported';
      }
      current = 'cause' in current ? current.cause : undefined;
    } catch {
      return 'unknown';
    }
  }
  return 'unknown';
}

function extractSqlState(error) {
  const seen = new Set();
  let current = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (!current || typeof current !== 'object' || seen.has(current)) return 'unknown';
    seen.add(current);
    try {
      if ('code' in current) {
        const code = safeSqlState(current.code);
        if (code !== 'unknown') return code;
      }
      current = 'cause' in current ? current.cause : undefined;
    } catch {
      return 'unknown';
    }
  }
  return 'unknown';
}

export class ProductionMigrationError extends Error {
  constructor(stage, cause) {
    super('Production migration failed.');
    this.name = 'ProductionMigrationError';
    this.stage = safeStage(stage);
    this.sqlState = extractSqlState(cause);
    this.reason = stage === 'configuration' ? 'configuration_missing' : classifyReason(cause, this.sqlState);
    this.cause = cause;
  }
}

function tagged(stage, error) {
  let cause = error;
  try {
    if (error instanceof ProductionMigrationError) cause = error.cause ?? error;
  } catch {
    cause = error;
  }
  return new ProductionMigrationError(safeStage(stage), cause);
}

export function formatProductionMigrationError(error) {
  let stage = 'unknown';
  let sqlState = 'unknown';
  let reason = 'unknown';
  try {
    if (error instanceof ProductionMigrationError) {
      stage = safeStage(error.stage);
      sqlState = safeSqlState(error.sqlState);
      reason = safeReason(error.reason);
    }
  } catch {
    stage = 'unknown';
    sqlState = 'unknown';
    reason = 'unknown';
  }
  return `Production migration failed (stage=${stage}, sqlstate=${sqlState}, reason=${reason}).`;
}

export async function runLockedMigration({
  url,
  migrationsFolder,
  createPool = (connectionUrl) => postgres(connectionUrl, { max: 1 }),
  applyMigrations = (session, folder) => migrate(drizzle(session), { migrationsFolder: folder }),
}) {
  if (!url) throw new ProductionMigrationError('configuration');
  let folder;
  try {
    folder = await validateMigrationTree(migrationsFolder);
  } catch (error) {
    throw tagged('validation', error);
  }
  let pool;
  try {
    pool = createPool(url);
  } catch (error) {
    throw tagged('connection', error);
  }
  let session;
  let locked = false;
  let failure;
  try {
    try {
      session = await pool.reserve();
    } catch (error) {
      throw tagged('connection', error);
    }
    try {
      await session.unsafe('select pg_advisory_lock($1)', [PRODUCTION_MIGRATION_LOCK]);
      locked = true;
    } catch (error) {
      throw tagged('lock', error);
    }
    try {
      await applyMigrations(session, folder);
    } catch (error) {
      throw tagged('migration', error);
    }
  } catch (error) {
    failure = error;
  } finally {
    if (session) {
      if (locked) {
        try {
          await session.unsafe('select pg_advisory_unlock($1)', [PRODUCTION_MIGRATION_LOCK]);
        } catch (error) {
          failure ??= tagged('unlock', error);
        }
      }
      try {
        session.release();
      } catch (error) {
        failure ??= tagged('release', error);
      }
    }
    try {
      await pool.end();
    } catch (error) {
      failure ??= tagged('close', error);
    }
  }
  if (failure) throw failure;
}

async function main() {
  await runLockedMigration({
    url: process.env.DATABASE_MIGRATION_URL,
    migrationsFolder: process.argv[2] ?? 'drizzle',
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(formatProductionMigrationError(error));
    process.exitCode = 1;
  });
}
