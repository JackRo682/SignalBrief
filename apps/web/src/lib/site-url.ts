export const PRODUCTION_SITE = 'https://signalbrief-beta.vercel.app';

export function siteOrigin(current: string, configured: string | undefined, production: boolean): string {
  const url = new URL(configured || (production ? PRODUCTION_SITE : current));
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && !production))) {
    throw new Error('invalid_site_url');
  }
  return url.origin;
}

// Resolve the origin before creating a PKCE verifier. A verifier cannot move between origins.
export async function startGoogleLogin(
  current: string, canonical: string, navigate: (url: string) => void,
  login: (redirectTo: string) => Promise<void>,
): Promise<void> {
  if (new URL(current).origin !== canonical) {
    navigate(`${canonical}/login`);
    return;
  }
  await login(`${canonical}/auth/callback`);
}
