import type {MetadataRoute} from 'next';
import {SITE_ORIGIN} from '@/lib/public-seo';
export default function robots():MetadataRoute.Robots{return {rules:{userAgent:'*',allow:'/',disallow:['/api/','/auth/','/ops','/today','/explore','/search','/watchlist','/portfolio','/timeline','/questions','/calendar','/alerts','/saved','/settings','/onboarding','/companies/','/events/','/documents/','/billing','/login','/signup','/forgot-password','/reset-password','/study/']},sitemap:SITE_ORIGIN+'/sitemap.xml'};}
