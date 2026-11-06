import { Suspense } from 'react';
import WorkspaceLoading from '@/components/workspace-loading';
import HomeExperiment from '@/redesign/home-experiment';
export default function Page() {
  return <Suspense fallback={<WorkspaceLoading />}><HomeExperiment /></Suspense>;
}
