import {publicMetadata} from '@/lib/public-seo';
export const metadata=publicMetadata('/features');
import {ReferencePage} from '@/components/marketing/reference-pages';
import './features.css';
export default function Page(){return <ReferencePage kind="features"/>;}
