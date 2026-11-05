/** Only known application routes may be used after authentication. */
export function safeSignInReturn(value: string | null | undefined): string {
  if (!value || value.length > 500 || /[\\%#?\s]/.test(value)) return '/today';
  const route = /^\/(?:today|explore|search|watchlist|calendar|saved|alerts|help|more|onboarding|settings(?:\/(?:account|security|notifications|appearance))?|ops(?:\/[a-z0-9_-]+){0,4}|(?:companies|events|documents)\/[a-zA-Z0-9_-]+(?:\/timeline)?)\/?$/;
  return route.test(value) ? value : '/today';
}

export function signInReturnFromUrl(url: string): string {
  return safeSignInReturn(new URL(url).searchParams.get('next'));
}

export function signInLink(path: string): string {
  return `/login?next=${encodeURIComponent(safeSignInReturn(path))}`;
}
