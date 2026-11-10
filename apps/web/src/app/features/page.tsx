import {publicMetadata} from '@/lib/public-seo';
export const metadata=publicMetadata('/features');
import {ReferencePage} from '@/components/marketing/reference-pages';
export default function Page(){return <ReferencePage kind="features"/>;}
