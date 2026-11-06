import { redirect } from 'next/navigation';
import { opsDetailHref } from '@/admin-logs/navigation';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(opsDetailHref('experiment', id));
}
