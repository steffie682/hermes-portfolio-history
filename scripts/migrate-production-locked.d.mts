export type ProductionMigrationStage =
  | 'configuration' | 'validation' | 'connection' | 'lock'
  | 'migration' | 'unlock' | 'release' | 'close' | 'unknown';
export class ProductionMigrationError extends Error {
  constructor(stage: ProductionMigrationStage, cause?: unknown);
  readonly stage: ProductionMigrationStage;
  readonly sqlState: string;
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
