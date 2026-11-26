// Accumulate only a focused, visible interval through the idle deadline.
export const IDLE_MS = 30_000;
export function activeClock(now: number) {
  let running = false, last = now, deadline = now, elapsed = 0;
  function sample(at: number) {
    if (running) elapsed += Math.max(0, Math.min(at, deadline) - last);
    last = at;
    return Math.min(86_400_000, Math.floor(elapsed));
  }
  return {
    sample,
    activity(at: number) { sample(at); deadline = at + IDLE_MS; },
    foreground(on: boolean, at: number) {
      sample(at);
      if (on && !running) deadline = at + IDLE_MS;
      running = on;
    },
  };
}
