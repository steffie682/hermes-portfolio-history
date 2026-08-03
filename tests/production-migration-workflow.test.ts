import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('production migration workflow', () => {
  const workflow = readFileSync('.github/workflows/production-migration.yml', 'utf8');
  const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
  const runner = readFileSync('scripts/migrate-production-locked.mjs', 'utf8');

  it('serializes exact reviewed commits and uses only the dedicated migration secret', () => {
    expect(workflow).toContain('group: production-database-migration');
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain('^[0-9a-f]{40}$');
    expect(workflow).toContain(`"$GITHUB_REF" != 'refs/heads/main'`);
    expect(workflow).toContain(`"$CONFIRMATION" != 'MIGRATE_PRODUCTION'`);
    expect(workflow).not.toContain("if: inputs.confirmation == 'MIGRATE_PRODUCTION'");
    expect(workflow).toContain('ref: ${{ github.sha }}');
    expect(workflow).toContain('ref: ${{ inputs.reviewed_commit }}');
    expect(workflow.match(/persist-credentials: false/g)).toHaveLength(2);
    expect(workflow).toContain('DATABASE_MIGRATION_URL: ${{ secrets.DATABASE_MIGRATION_URL }}');
    expect(workflow).not.toMatch(/DATABASE_URL[^_]/);
    expect(workflow).toContain('node release/scripts/migrate-production-locked.mjs');
    expect(workflow).not.toContain('node candidate/scripts');
  });

  it('logs only a safe stage and SQLSTATE classification on migration failure', () => {
    expect(runner).toContain('stage=${stage}, sqlstate=${sqlState}');
    expect(runner).not.toMatch(/console\.error\([^)]*(cause|url|message)/);
  });

  it('pins Vercel to the npm lifecycle that was verified by builds', () => {
    expect(vercel.buildCommand).toBe('npm run build');
  });
});
