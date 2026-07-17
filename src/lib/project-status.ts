export type ProjectStatus = {
  stage: 'foundation';
  implementedFeatures: string[];
};

export function getProjectStatus(): ProjectStatus {
  return { stage: 'foundation', implementedFeatures: [] };
}
