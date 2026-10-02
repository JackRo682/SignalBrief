import { defineConfig,devices } from "@playwright/test";
export default defineConfig({ testDir:"./e2e",fullyParallel:false,workers:1,timeout:45000,
  use:{baseURL:process.env.E2E_BASE_URL??"http://127.0.0.1:3000",trace:"retain-on-failure"},
  reporter:[["list"],["html",{open:"never"}]],
  projects:[{name:"desktop",use:{...devices["Desktop Chrome"]}},{name:"mobile",use:{...devices["Pixel 7"]}}],
  // Start a clean demo API, worker and Next server first; never point this suite at production.
});
