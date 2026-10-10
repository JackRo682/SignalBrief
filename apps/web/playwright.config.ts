import { defineConfig,devices } from "@playwright/test";
export default defineConfig({testDir:"./e2e",fullyParallel:false,workers:1,timeout:180000,
 expect:{timeout:20000},
 use:{baseURL:process.env.E2E_BASE_URL??"http://127.0.0.1:3000",trace:"retain-on-failure",launchOptions:process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{}},
 reporter:[["list"],["html",{open:"never"}]],
 projects:[{name:"desktop",use:{...devices["Desktop Chrome"]}},{name:"mobile",use:{...devices["Pixel 7"]}}],
 // Start a clean local demo API/worker/web server; never point this suite at production.
});
