import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/performance",
  workers: 1,
  outputDir: "test-results/performance",
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report/performance" }]],
  use: {
    baseURL: "http://127.0.0.1:4174",
    locale: "en-US",
    timezoneId: "UTC",
    trace: "off",
  },
  webServer: {
    command: "npx vite preview --port 4174",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: false,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
  ],
});
