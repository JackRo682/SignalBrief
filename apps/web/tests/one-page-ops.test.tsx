import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpsDetailLink, OpsWorkspaceProvider, type OpsWorkspace } from '../src/admin-logs/workspace-context';
import { opsDetailHref, opsDetailReturnPath, parseOpsDetail, type OpsDetailKind } from '../src/admin-logs/navigation';
import ExperimentsPage from '../src/app/(workspace)/ops/experiments/page';
import EvaluationsPage from '../src/app/(workspace)/ops/evaluations/page';
import QualityPage from '../src/app/(workspace)/ops/quality/page';
import ReliabilityPage from '../src/app/(workspace)/ops/reliability/page';
import ReportsPage from '../src/app/(workspace)/ops/reports/page';
import ExperimentPage from '../src/app/(workspace)/ops/experiments/[id]/page';
import DatasetPage from '../src/app/(workspace)/ops/evaluations/datasets/[id]/page';
import EvaluationPage from '../src/app/(workspace)/ops/evaluations/runs/[id]/page';
import DocumentPage from '../src/app/(workspace)/ops/documents/[id]/page';
import RunPage from '../src/app/(workspace)/ops/runs/[id]/page';

const mock = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: mock.redirect }));
const id = '10000000-0000-4000-8000-000000000321';
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('one-page operations bookmarks', () => {
  it.each([
    ['experiments', ExperimentsPage], ['evaluations', EvaluationsPage], ['quality', QualityPage],
    ['reliability', ReliabilityPage], ['reports', ReportsPage],
  ] as const)('redirects the old %s page to its section', (section, Page) => {
    Page();
    expect(mock.redirect).toHaveBeenCalledExactlyOnceWith(`/ops#operations-${section}`);
  });

  it.each([
    ['experiment', 'experiments', ExperimentPage], ['dataset', 'evaluations/datasets', DatasetPage],
    ['evaluation', 'evaluations/runs', EvaluationPage], ['document', 'documents', DocumentPage], ['run', 'runs', RunPage],
  ] as const)('preserves a bookmarked %s record through canonical and login navigation', async (kind, path, Page) => {
    await Page({ params: Promise.resolve({ id }) });
    expect(mock.redirect).toHaveBeenCalledExactlyOnceWith(`/ops?detail=${kind}&id=${id}#operations-detail`);
    expect(opsDetailReturnPath({ kind, id })).toBe(`/ops/${path}/${id}`);
  });

  it.each([
    ['__proto__', id], ['https://example.invalid', id], [['experiment'], id],
    ['experiment', '../private'], ['document', ['10000000-0000-4000-8000-000000000321']],
  ])('rejects an invalid detail selector %s without constructing another route', (kind, value) => {
    expect(parseOpsDetail(kind, value)).toBeNull();
    expect(opsDetailHref(kind as OpsDetailKind, value as string)).toBe('/ops');
  });
});

describe('inline operations links', () => {
  it('opens the selected record through the existing workspace and keeps a canonical bookmark', () => {
    const workspace: OpsWorkspace = { refreshVersion: 0, refreshAll: vi.fn(), deny: vi.fn(), openDetail: vi.fn() };
    render(<OpsWorkspaceProvider value={workspace}><OpsDetailLink kind="experiment" id={id}>Synthetic experiment</OpsDetailLink></OpsWorkspaceProvider>);
    const link = screen.getByRole('link', { name: 'Synthetic experiment' });
    expect(link).toHaveAttribute('href', `/ops?detail=experiment&id=${id}#operations-detail`);
    fireEvent.click(link);
    expect(workspace.openDetail).toHaveBeenCalledExactlyOnceWith({ kind: 'experiment', id });
    expect(workspace.refreshAll).not.toHaveBeenCalled();
  });

  it('does not render malformed record identifiers as navigable links', () => {
    render(<OpsDetailLink kind="document" id="invalid-record">Synthetic document</OpsDetailLink>);
    expect(screen.getByText('Synthetic document')).toBeVisible();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
