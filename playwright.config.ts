// Local codegen config — makes playwright codegen prefer id attributes over
// accessible role/text locators. Use when recording UI flows locally:
//   npx playwright codegen --config=playwright.config.ts <url>
import { defineConfig } from '@playwright/test';

export default defineConfig({
  use: {
    testIdAttribute: 'id',
    ignoreHTTPSErrors: true,
  },
});
