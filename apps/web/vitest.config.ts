import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
export default defineConfig({ plugins:[react()], resolve:{alias:{"@":fileURLToPath(new URL("./src",import.meta.url))}},
  test:{setupFiles:["./tests/cache-isolation.setup.ts"],environment:"jsdom",include:["tests/**/*.test.ts","tests/**/*.test.tsx"],restoreMocks:true}});
