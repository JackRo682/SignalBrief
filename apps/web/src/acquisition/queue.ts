// Public landing and signed-in actions share one transport order, so a slow
// landing request cannot be overtaken by a later search in the same browser.
let pending: Promise<unknown> = Promise.resolve();

export function enqueueTraffic<T>(task: () => Promise<T>): Promise<T> {
  const next = pending.then(task);
  pending = next.catch(() => undefined);
  return next;
}
