import type {NextRequest} from 'next/server';
import {proxyUS} from '@/server/us-proxy';
export const runtime='nodejs';export const dynamic='force-dynamic';
export function GET(req:NextRequest){return proxyUS(req,'quotes');}
