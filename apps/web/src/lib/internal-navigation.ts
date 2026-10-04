export function internalNavigation(event: MouseEvent, current: string): string | null {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
  if (!anchor || (anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return null;
  const here = new URL(current), url = new URL(anchor.getAttribute('href')!, here);
  if (url.origin !== here.origin || !['http:', 'https:'].includes(url.protocol)) return null;
  // Leave evidence anchors to the browser so scrolling/focus keeps its native behavior.
  if (url.pathname === here.pathname && url.search === here.search && url.hash) return null;
  return url.pathname + url.search + url.hash;
}
