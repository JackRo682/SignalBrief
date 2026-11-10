import {ReferencePage} from '@/components/marketing/reference-pages';
import {publicMetadata} from '@/lib/public-seo';
export const metadata=publicMetadata('/');
export default function Page(){return <ReferencePage kind="home"/>;}
