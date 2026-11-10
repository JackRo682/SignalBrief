import type {MetadataRoute} from 'next';
import {PUBLIC_ORIGIN,publicIndexing,publicPages} from '@/lib/public-seo';
export default function sitemap():MetadataRoute.Sitemap{
 return publicIndexing()?Object.keys(publicPages).map(path=>({url:new URL(path,PUBLIC_ORIGIN).href})):[];
}
