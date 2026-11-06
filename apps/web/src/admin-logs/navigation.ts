export const opsDetailKinds = ['experiment', 'dataset', 'evaluation', 'document', 'run'] as const;
export type OpsDetailKind = typeof opsDetailKinds[number];
export type OpsDetail = { kind: OpsDetailKind; id: string };

const recordId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseOpsDetail(kind: unknown, id: unknown): OpsDetail | null {
  return typeof kind === 'string' && opsDetailKinds.includes(kind as OpsDetailKind) && typeof id === 'string' && recordId.test(id)
    ? { kind: kind as OpsDetailKind, id } : null;
}

export function opsDetailHref(kind: OpsDetailKind, id: string) {
  const detail = parseOpsDetail(kind, id);
  return detail ? `/ops?detail=${detail.kind}&id=${encodeURIComponent(detail.id)}#operations-detail` : '/ops';
}

export function opsDetailSection(kind: OpsDetailKind) {
  return kind === 'experiment' ? 'operations-experiments'
    : kind === 'dataset' || kind === 'evaluation' ? 'operations-evaluations' : 'operations-data';
}

/** Auth accepts known paths only; legacy redirects restore the selected record. */
export function opsDetailReturnPath(detail: OpsDetail | null) {
  const valid = detail && parseOpsDetail(detail.kind, detail.id);
  if (!valid) return '/ops';
  const paths: Record<OpsDetailKind, string> = {
    experiment: 'experiments', dataset: 'evaluations/datasets', evaluation: 'evaluations/runs', document: 'documents', run: 'runs',
  };
  return `/ops/${paths[valid.kind]}/${valid.id}`;
}
