import type {MetadataRoute} from 'next';
import {publicPages,SITE_ORIGIN} from '@/lib/public-seo';
export default function sitemap():MetadataRoute.Sitemap{return publicPages.map(page=>({url:SITE_ORIGIN+page.path}));}
