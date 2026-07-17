import { describe, expect, it } from 'vitest';
import { getProjectStatus } from '@/lib/project-status';

describe('getProjectStatus', () => {
  it('reports the application as under development without invented features', () => {
    expect(getProjectStatus()).toEqual({
      stage: 'foundation',
      implementedFeatures: [],
    });
  });
});
