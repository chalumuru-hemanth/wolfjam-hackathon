import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser', outputDir: './test-results',
  timeout: 30000, workers: 1, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5173', channel: 'chrome', headless: true,
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
    screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'phone', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'landscape', use: { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true } },
  ],
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: true, timeout: 20000 },
});
