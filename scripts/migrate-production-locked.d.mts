export function validateMigrationTree(migrationsFolder: string): Promise<string>;
export interface LockedMigrationOptions {
  url: string | undefined;
  migrationsFolder: string;
  createPool?: (url: string) => unknown;
  applyMigrations?: (session: unknown, folder: string) => Promise<void>;
}
export function runLockedMigration(options: LockedMigrationOptions): Promise<void>;
