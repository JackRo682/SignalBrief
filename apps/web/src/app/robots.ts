import type {MetadataRoute} from 'next';
import {PUBLIC_ORIGIN,publicIndexing} from '@/lib/public-seo';
export default function robots():MetadataRoute.Robots{
 if(!publicIndexing())return {rules:{userAgent:'*',disallow:'/'}};
 // Private HTML remains noindex and authorization-protected. Let bots read that directive.
 return {rules:{userAgent:'*',allow:'/',disallow:['/api/']},sitemap:`${PUBLIC_ORIGIN}/sitemap.xml`,host:PUBLIC_ORIGIN};
}
