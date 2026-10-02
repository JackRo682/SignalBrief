import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/ui",
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/ui-results.json" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:3117",
    headless: true,
    channel:
      process.env.PLAYWRIGHT_CHANNEL ||
      (process.platform === "win32" ? "msedge" : undefined),
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    reducedMotion: "reduce",
  },
  webServer: {
    command: "npm run start --workspace @signalbrief/web -- --port 3117",
    url: "http://127.0.0.1:3117",
    reuseExistingServer: false,
    timeout: 60000,
    env: { NEXT_TELEMETRY_DISABLED: "1" },
  },
});
