import { test as base, expect } from "@playwright/test";
let nextRequest = 0;
export const test = base.extend<{ respectApiQuota: void }>({
  respectApiQuota: [async ({ page }, use) => {
    // Respect the unchanged 120/minute application limit in automated browser journeys.
    // Separate rate-limit unit tests deliberately exercise rejection at the boundary.
    await page.route("http://localhost:8000/**", async route => {
      const delay = Math.max(0, nextRequest - Date.now());
      nextRequest = Math.max(Date.now(), nextRequest) + 900;
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      await route.continue();
    });
    await use();
  }, { auto: true }]
});
export { expect };
