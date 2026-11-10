import {publicMetadata} from '@/lib/public-seo';
export const metadata=publicMetadata('/disclaimer');
import {LegalReferencePage} from '@/components/marketing/legal-reference';
export default function Page(){return <LegalReferencePage kind="disclaimer"/>;}
