import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/ui",
  timeout: 45000,
  workers: 1,
  reporter: "list",
  webServer: {
    command: "node scripts/prepare-ui.mjs",
    url: "http://localhost:4174/healthz",
    reuseExistingServer: false,
    timeout: 20000,
  },
  outputDir: ".verification/playwright",
  use: {
    baseURL: "http://localhost:4174",
    browserName: "chromium",
    channel: "chrome",
    trace: "retain-on-failure",
  },
});
