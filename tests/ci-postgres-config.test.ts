import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('CI PostgreSQL integration configuration', () => {
  it('provides the real PostgreSQL test database to npm test', async () => {
    const workflow = await readFile('.github/workflows/ci.yml', 'utf8');

    expect(workflow).toContain('services:');
    expect(workflow).toContain('image: postgres:16.4-bookworm@sha256:');
    expect(workflow).toContain('POSTGRES_DB: portfolio_history_test');
    expect(workflow).toContain('TEST_DATABASE_ADMIN_URL: postgresql://postgres:postgres@127.0.0.1:5432/portfolio_history_test');
    expect(workflow).toContain('pg_isready -U postgres -d portfolio_history_test');
    expect(workflow.indexOf('TEST_DATABASE_ADMIN_URL')).toBeLessThan(
      workflow.indexOf('- run: npm test'),
    );
  });
});
