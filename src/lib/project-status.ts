export type ProjectStatus = {
  stage: 'evidence-overview';
  implementedFeatures: string[];
  unimplementedFeatures: string[];
};

export function getProjectStatus(): ProjectStatus {
  return {
    stage: 'evidence-overview',
    implementedFeatures: [
      'passkey-authentication',
      'private-sbi-import',
      'append-only-ledger',
      'balance-evidence-overview',
    ],
    unimplementedFeatures: [
      'total-assets',
      'net-contributions',
      'investment-profit-loss',
      'dividend-yoc',
    ],
  };
}
