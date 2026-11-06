import { redirect } from 'next/navigation';
import UserActivityLogs from '@/admin-logs/page';
import { parseOpsDetail } from '@/admin-logs/navigation';

const previousViews: Record<string, string> = {
  data: 'operations-data', model: 'operations-data', users: 'operations-users', audit: 'operations-audit',
};

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string | string[]; detail?: string | string[]; id?: string | string[] }> }) {
  const { view, detail, id } = await searchParams;
  if (typeof view === 'string' && Object.hasOwn(previousViews, view)) redirect(`/ops#${previousViews[view]}`);
  return <UserActivityLogs unified initialDetail={parseOpsDetail(detail, id)}/>;
}
