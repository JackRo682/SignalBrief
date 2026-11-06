'use client';

import { useEffect, useRef } from 'react';
import Experiments, { ExperimentDetail } from '@/research/experiments';
import Evaluations, { DatasetDetail, EvaluationRun } from '@/research/evaluations';
import { Quality, Reliability, Reports } from '@/research/operations';
import OpsDocument from '@/screens/ops-document';
import OpsRun from '@/screens/ops-run';
import type { OpsDetail } from './navigation';

export function ResearchPanels() {
  return <>
    <section id="operations-experiments" className="ops-research-section" aria-label="A/B 실험 관리"><Experiments/></section>
    <section id="operations-evaluations" className="ops-research-section" aria-label="AI 평가 관리"><Evaluations/></section>
    <section id="operations-quality" className="ops-research-section" aria-label="금융정보 품질 검수"><Quality/></section>
    <section id="operations-reliability" className="ops-research-section" aria-label="장애·안전성 관리"><Reliability/></section>
    <section id="operations-reports" className="ops-research-section" aria-label="실험·평가 보고서"><Reports/></section>
  </>;
}

export function OperationDetailPanel({ detail, close }: { detail: OpsDetail; close: () => void }) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
    panel.current?.scrollIntoView?.({ block: 'start' });
  }, [detail.kind, detail.id]);
  return <section ref={panel} id="operations-detail" className="ops-detail-panel" aria-label="선택한 운영 항목 상세" tabIndex={-1}>
    <div className="ops-detail-bar"><span>선택한 항목 상세</span><button type="button" className="button secondary" onClick={close}>상세 닫기</button></div>
    {detail.kind === 'experiment' && <ExperimentDetail id={detail.id}/>}
    {detail.kind === 'dataset' && <DatasetDetail id={detail.id}/>}
    {detail.kind === 'evaluation' && <EvaluationRun id={detail.id}/>}
    {detail.kind === 'document' && <OpsDocument id={detail.id}/>}
    {detail.kind === 'run' && <OpsRun id={detail.id}/>}
  </section>;
}
