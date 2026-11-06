import { redirect } from 'next/navigation';
import UserActivityLogs from '@/admin-logs/page';

const previousViews: Record<string, string> = {
  data: 'operations-data', model: 'operations-data', users: 'operations-users', audit: 'operations-audit',
};

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string | string[] }> }) {
  const { view } = await searchParams;
  if (typeof view === 'string' && Object.hasOwn(previousViews, view)) redirect(`/ops#${previousViews[view]}`);
  return <UserActivityLogs unified/>;
}
