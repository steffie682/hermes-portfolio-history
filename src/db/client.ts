import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

let client: ReturnType<typeof postgres> | undefined;
let database: ReturnType<typeof drizzle> | undefined;

export function getDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  if (!client) {
    client = postgres(databaseUrl, { prepare: false });
    database = drizzle({ client });
  }
  return database!;
}

export type AppDatabase = ReturnType<typeof getDatabase>;
