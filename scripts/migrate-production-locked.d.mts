export type ProductionMigrationStage =
  | 'configuration' | 'validation' | 'connection' | 'lock'
  | 'migration' | 'unlock' | 'release' | 'close' | 'unknown';
export type ProductionMigrationReason =
  | 'configuration_missing' | 'migration_history_mismatch' | 'migration_table_upgrade_missing'
  | 'driver_transaction_unsupported' | 'postgres_error' | 'unknown';
export class ProductionMigrationError extends Error {
  constructor(stage: ProductionMigrationStage, cause?: unknown);
  readonly stage: ProductionMigrationStage;
  readonly sqlState: string;
  readonly reason: ProductionMigrationReason;
}
export function formatProductionMigrationError(error: unknown): string;
export function validateMigrationTree(migrationsFolder: string): Promise<string>;
export interface LockedMigrationOptions {
  url: string | undefined;
  migrationsFolder: string;
  createPool?: (url: string) => unknown;
  applyMigrations?: (session: unknown, folder: string) => Promise<void>;
}
export function runLockedMigration(options: LockedMigrationOptions): Promise<void>;
