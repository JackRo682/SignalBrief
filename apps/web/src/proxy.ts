import { NextResponse, type NextRequest } from 'next/server';
import { siteOrigin } from './lib/site-url';

export function proxy(request: NextRequest) {
  if (process.env.VERCEL_ENV !== 'production') return NextResponse.next();
  const origin = siteOrigin(request.url, process.env.NEXT_PUBLIC_SITE_URL, true);
  if (request.nextUrl.origin === origin) return NextResponse.next();
  const target = new URL(origin);
  target.pathname = request.nextUrl.pathname;
  target.search = request.nextUrl.search;
  return NextResponse.redirect(target, 307);
}

export const config = { matcher: ['/((?!api|_next|reference-assets|favicon.ico).*)'] };
