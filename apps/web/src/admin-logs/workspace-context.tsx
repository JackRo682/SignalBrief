'use client';

import Link from 'next/link';
import { createContext, useContext, type ReactNode } from 'react';
import { opsDetailHref, parseOpsDetail, type OpsDetail, type OpsDetailKind } from './navigation';

export { opsDetailHref } from './navigation';
export type { OpsDetail, OpsDetailKind } from './navigation';

export type OpsWorkspace = {
  refreshVersion: number;
  refreshAll: () => void;
  deny: (error: { status: number; code: string }) => void;
  openDetail: (detail: OpsDetail) => void;
};

const OpsWorkspaceContext = createContext<OpsWorkspace | null>(null);
export const OpsWorkspaceProvider = OpsWorkspaceContext.Provider;
export function useOpsWorkspace() { return useContext(OpsWorkspaceContext); }

export function OpsDetailLink({ kind, id, children, className }: {
  kind: OpsDetailKind; id: string; children: ReactNode; className?: string;
}) {
  const workspace = useOpsWorkspace();
  const detail = parseOpsDetail(kind, id);
  if (!detail) return <span className={className}>{children}</span>;
  return <Link className={className} href={opsDetailHref(kind, id)} scroll={false} onClick={event => {
    if (!workspace || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    workspace.openDetail(detail);
  }}>{children}</Link>;
}
