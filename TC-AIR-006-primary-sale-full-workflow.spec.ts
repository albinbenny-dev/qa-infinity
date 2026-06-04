// TC-AIR-006-primary-sale-full-workflow.spec.ts
//
// qa-infinity compatible script.
// Environment variables required (configure in qa-infinity project settings):
//
//   BASE_URL        — app origin, e.g. https://usdm.internal
//   TC_USERNAME     — Nigeria2 username  (also read as TC_USERNAME_N2)
//   TC_PASSWORD     — Nigeria2 password  (also read as TC_PASSWORD_N2)
//   TC_USERNAME_N3  — Nigeria3 username
//   TC_PASSWORD_N3  — Nigeria3 password
//   TC_USERNAME_N4  — Nigeria4 username
//   TC_PASSWORD_N4  — Nigeria4 password

import { test, expect, Page } from '@playwright/test';

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL    = 'https://airtel6d-in-ventas-master-int-aavm-alpha-01.ocplab.6d.local';
const USERNAME_N2 = 'Nigeria2';
const PASSWORD_N2 = 'pass@6Dtech';
const USERNAME_N3 = 'Nigeria3';
const PASSWORD_N3 = 'pass@6Dtech';
const USERNAME_N4 = 'Nigeria4';
const PASSWORD_N4 = 'pass@6Dtech';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function login(page: Page, baseUrl: string, username: string, password: string) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('#username').fill(username);
  await page.locator('#kc-login').click();
  await page.locator('#password').waitFor({ state: 'visible' });
  await page.locator('#password').click();
  await page.locator('#password').pressSequentially(password, { delay: 80 });
  await page.locator('#password').press('Enter');
  await page.waitForURL('**/myProfile', { timeout: 30_000 });
  await page.waitForLoadState('domcontentloaded');
}

async function jsNavTo(page: Page, hash: string) {
  await page.evaluate((h: string) => {
    const link = document.querySelector<HTMLAnchorElement>(`a[href="${h}"]`);
    if (link) link.click(); else window.location.hash = h;
  }, hash);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);
}

// ── Test ──────────────────────────────────────────────────────────────────────

test('TC-AIR-006 — Primary Sale Full Workflow (Create → Approve → Allocate → Verify)', async ({ browser }, testInfo) => {
  test.setTimeout(600_000);

  const baseUrl    = BASE_URL;
  const usernameN2 = USERNAME_N2;
  const passwordN2 = PASSWORD_N2;
  const usernameN3 = USERNAME_N3;
  const passwordN3 = PASSWORD_N3;
  const usernameN4 = USERNAME_N4;
  const passwordN4 = PASSWORD_N4;

  // Ensure video and screenshots are recorded for all manually-created contexts.
  // browser.newContext() bypasses use.video / use.screenshot from the config, so
  // these options must be passed explicitly.
  const artifactOpts = {
    recordVideo: { dir: testInfo.outputDir },
    screenshot:  'only-on-failure' as const,
  };

  const ctx2  = await browser.newContext({ ignoreHTTPSErrors: true, ...artifactOpts });
  const ctx3  = await browser.newContext({ ignoreHTTPSErrors: true, ...artifactOpts });
  const ctx4  = await browser.newContext({ ignoreHTTPSErrors: true, ...artifactOpts });
  const page2 = await ctx2.newPage();
  const page3 = await ctx3.newPage();
  const page4 = await ctx4.newPage();

  let orderId = '';

  try {

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 1  Nigeria2 — Create Primary Sale order
    // ─────────────────────────────────────────────────────────────────────────

    await login(page2, baseUrl, usernameN2, passwordN2);

    await jsNavTo(page2, '#/pos/primarysales');
    await page2.waitForTimeout(1000);

    await page2.locator('button.btn-app-primary').filter({ hasText: 'Create Order' }).click();
    await page2.waitForTimeout(1000);

    // Buyer type
    await page2.locator('div.component-alignment').filter({ hasText: /^Distributor$/ }).first().click();
    await page2.waitForTimeout(800);

    // Customer
    const custInput = page2.locator('input.cpm-dropdown-input').first();
    await custInput.click();
    await custInput.pressSequentially('2 brothers float exchange', { delay: 60 });
    await page2.waitForTimeout(4000);
    await page2.locator('.cpm-dropdown-list > *').filter({ hasText: /2 brothers/i }).first().click();
    await page2.waitForTimeout(1000);

    // Physical product type
    await page2.locator('span.product-name').filter({ hasText: /^Physical$/ }).click();
    await page2.waitForTimeout(500);

    // Source warehouse
    await page2.locator('#sixdee_single_selectfield_sourceWarehouse .select-form__control').click();
    await page2.locator('#react-select-3-input').pressSequentially('AIRTEL DHL', { delay: 50 });
    await page2.waitForTimeout(2000);
    await page2.locator('.select-form__option').filter({ hasText: 'AIRTEL DHL WAREHOUSE' }).first().click();
    await page2.waitForTimeout(500);

    // Proceed (buyer form)
    await page2.locator('button.btn-app-primary').filter({ hasText: /^Proceed$/ }).click();
    await page2.waitForLoadState('networkidle');
    await page2.waitForTimeout(2000);

    // Product search
    await page2.locator('.search-filter-wrapper').first().click();
    await page2.waitForTimeout(2000);
    await page2.locator('input[name="productCode"]').fill('110121347');
    await page2.locator('button.btn-app-primary').filter({ hasText: /^Search$/ }).first().click();
    await page2.waitForTimeout(3000);

    const productCard = page2.locator('.product-card-container.cursor-pointer').first();
    if (await productCard.count() === 0) throw new Error('Product card not found for code 110121347');
    await productCard.click({ force: true });
    await page2.waitForTimeout(1500);

    // Qty → Add to Cart
    const qtyInput = page2.locator('input.qty-value-cart-pos');
    await qtyInput.click({ clickCount: 3 });
    await qtyInput.fill('1');
    await page2.waitForTimeout(300);

    const addToCartBtn = page2.locator('button.btn-app-primary').filter({ hasText: /Add to Cart/i });
    if (await addToCartBtn.count() === 0) throw new Error('Add to Cart button not found');
    await addToCartBtn.first().click({ force: true });
    await page2.waitForTimeout(2000);

    // Proceed (product screen) → Submit & Process Order
    await page2.locator('button.btn-app-primary').filter({ hasText: /^Proceed$/ }).click();
    await page2.waitForLoadState('networkidle');
    await page2.waitForTimeout(2000);

    await page2.locator('button.btn-app-primary').filter({ hasText: /Submit.*Process Order/i }).click();
    await page2.waitForTimeout(2000);

    // Confirmation modal
    const confirmBtn = page2.locator('button.btn-app-primary').filter({ hasText: /^Submit Order$/ }).first();
    if (await confirmBtn.count() > 0) {
      await confirmBtn.click({ force: true });
      await page2.waitForTimeout(5000);
    }

    // Duplicate order dialog (if shown)
    const dupBtn = page2.locator('button').filter({ hasText: /^Continue$/ });
    if (await dupBtn.count() > 0 && await dupBtn.first().isVisible()) {
      await dupBtn.first().click();
      await page2.waitForTimeout(3000);
    }

    // Capture Order ID
    const orderIdEl = page2.locator('.order-deatils-container-with-bg .card-component-body-value').first();
    await orderIdEl.waitFor({ state: 'attached', timeout: 30_000 });
    orderId = ((await orderIdEl.textContent()) ?? '').trim();
    expect(orderId).toBeTruthy();
    console.log(`[STEP 1] Order created: ${orderId}`);

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 2  Nigeria3 — Approve in My Tasks
    // ─────────────────────────────────────────────────────────────────────────

    await login(page3, baseUrl, usernameN3, passwordN3);
    await jsNavTo(page3, '#/cpm/approvalmytask');
    await page3.waitForTimeout(2000);

    const approvalDeadline = Date.now() + 3 * 60 * 1000;
    let approvalFound = false;

    while (Date.now() < approvalDeadline) {
      const taskInput = page3.locator('#sixdee_field_input_orderId');
      await taskInput.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
      await taskInput.click({ clickCount: 3 });
      await taskInput.fill(orderId);
      await page3.locator('button.btn-app-primary').filter({ hasText: /^Search$/ }).first().click();
      await page3.waitForTimeout(3000);

      if (await page3.locator('tr.approvalTableBody').filter({ hasText: orderId }).count() > 0) {
        approvalFound = true;
        break;
      }
      await page3.waitForTimeout(15_000);
    }

    if (!approvalFound) {
      console.warn(`[STEP 2] Order ${orderId} not found in My Tasks after 3 min — may have auto-approved`);
    } else {
      const orderRow = page3.locator('tr.approvalTableBody').filter({ hasText: orderId }).first();
      await orderRow.locator('td.fit-content.clickable_ico_dt').first().click();
      await page3.waitForLoadState('networkidle');
      await page3.waitForTimeout(2000);

      await page3.locator('button').filter({ hasText: /^Approve$/i }).first().waitFor({ state: 'visible', timeout: 10_000 });
      await page3.locator('button').filter({ hasText: /^Approve$/i }).first().click();
      await page3.waitForTimeout(2000);

      const commentField = page3.locator('textarea, input[placeholder*="omment"], input[placeholder*="emark"]').first();
      if (await commentField.count() > 0) {
        await commentField.click({ clickCount: 3 });
        await commentField.fill('Approved');
        await page3.waitForTimeout(500);
      }

      const approveSubmitBtn = page3.locator('button.btn-app-primary').filter({ hasText: /^Submit$/i }).first();
      if (await approveSubmitBtn.count() > 0) {
        await approveSubmitBtn.click();
      } else {
        const fallback = page3.locator('button').filter({ hasText: /Submit|Confirm|OK|Yes/i }).first();
        if (await fallback.count() > 0) await fallback.click();
      }
      await page3.waitForTimeout(3000);
      console.log(`[STEP 2] Order ${orderId} approved`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 3  Nigeria4 — Allocate stock
    // ─────────────────────────────────────────────────────────────────────────

    await login(page4, baseUrl, usernameN4, passwordN4);

    const allocDeadline = Date.now() + 2 * 60 * 1000;
    let allocRowFound   = false;

    while (Date.now() < allocDeadline) {
      await jsNavTo(page4, '#/arm/StockManagement');
      const stockAllocTab = page4.locator('.nav-tabs .nav-link').filter({ hasText: /^Stock Allocation$/ });
      await stockAllocTab.waitFor({ state: 'visible', timeout: 10_000 });
      await stockAllocTab.click();
      await page4.waitForTimeout(2000);

      await page4.locator('button:has(.filter-icon)').first().scrollIntoViewIfNeeded().catch(() => {});
      await page4.locator('button:has(.filter-icon)').first().click({ force: true });
      await page4.waitForTimeout(1500);

      const saleOrderInput = page4.locator('input[name="filterexternalReferenceId"]');
      await saleOrderInput.waitFor({ state: 'visible', timeout: 8_000 });
      await saleOrderInput.click({ clickCount: 3 });
      await saleOrderInput.fill(orderId);
      await page4.locator('button.btn-app-primary').filter({ hasText: /^Search$/ }).first().click();
      await page4.waitForTimeout(2500);

      if (await page4.locator('tbody tr').count() > 0) { allocRowFound = true; break; }
      await page4.waitForTimeout(20_000);
    }
    if (!allocRowFound) throw new Error(`Order ${orderId} never appeared in Stock Allocation`);

    // Hover row → Allocate
    const targetRow = page4.locator('tr').filter({ hasText: orderId }).first();
    const useRow    = (await targetRow.count()) > 0 ? targetRow : page4.locator('tbody tr').first();
    await useRow.hover();
    await page4.waitForTimeout(600);
    await page4.locator('button.arm-no-btn.arm-table-link').filter({ hasText: /^Allocate$/ }).first().click({ force: true });
    await page4.waitForTimeout(3000);

    // Allocation form
    await page4.locator('input[name="dispatchBy"]').waitFor({ state: 'visible', timeout: 15_000 });

    // Dispatch Mode = Pickup
    await page4.locator('#sixdee_single_selectfield_dispatchMode .select-form__control').click();
    await page4.waitForTimeout(1000);
    await page4.locator('.select-form__option').filter({ hasText: /Pickup/i }).first().click();
    await page4.waitForTimeout(500);

    // Dispatch By
    await page4.locator('input[name="dispatchBy"]').click({ clickCount: 3 });
    await page4.locator('input[name="dispatchBy"]').fill('Airtel');

    // Dispatch DOC (random 8-digit)
    const dispatchDoc = String(Math.floor(10_000_000 + Math.random() * 90_000_000));
    await page4.locator('input[name="dispatchDocNo"]').click({ clickCount: 3 });
    await page4.locator('input[name="dispatchDocNo"]').fill(dispatchDoc);
    await page4.waitForTimeout(300);

    // Range radio
    await page4.locator('label[for="sixdee_searchType_undefined_radio_0"]').click();
    await page4.waitForTimeout(500);

    // Allocated Ranges
    await page4.locator('button.no-btn.text-blue').filter({ hasText: /Allocated Ranges/i }).waitFor({ state: 'visible', timeout: 8_000 });
    await page4.locator('button.no-btn.text-blue').filter({ hasText: /Allocated Ranges/i }).click();
    await page4.waitForTimeout(2000);

    // Serial (13-digit, generated inline)
    const serial = `876545${Date.now().toString().slice(-7)}`;
    await page4.locator('#sixdee_field_input_fromAssetId').waitFor({ state: 'visible', timeout: 10_000 });
    await page4.locator('#sixdee_field_input_fromAssetId').click({ clickCount: 3 });
    await page4.locator('#sixdee_field_input_fromAssetId').fill(serial);
    await page4.locator('#sixdee_field_input_toAssetId').click({ clickCount: 3 });
    await page4.locator('#sixdee_field_input_toAssetId').fill(serial);
    await page4.waitForTimeout(300);

    await page4.locator('button.btn-app-primary').filter({ hasText: /^Add$/i }).first().click();
    await page4.waitForTimeout(1000);
    await page4.locator('button.btn-app-primary').filter({ hasText: /^Submit$/ }).first().click();
    await page4.waitForTimeout(3000);
    console.log(`[STEP 3] Allocation submitted — serial ${serial}, DOC ${dispatchDoc}`);

    // Mandatory: verify Delivered status in Stock Allocation list
    await jsNavTo(page4, '#/arm/StockManagement');
    await page4.locator('.nav-tabs .nav-link').filter({ hasText: /^Stock Allocation$/ }).waitFor({ state: 'visible', timeout: 10_000 });
    await page4.locator('.nav-tabs .nav-link').filter({ hasText: /^Stock Allocation$/ }).click();
    await page4.waitForLoadState('networkidle');
    await page4.waitForTimeout(3000);

    await page4.locator('button:has([class*="refresh"])').first().waitFor({ state: 'visible', timeout: 10_000 });
    await page4.locator('button:has([class*="refresh"])').first().click();
    await page4.waitForLoadState('networkidle');
    await page4.waitForTimeout(2000);

    const filterStillOpen = await page4.locator('input[name="filterexternalReferenceId"]').isVisible().catch(() => false);
    if (!filterStillOpen) {
      await page4.locator('button:has(.filter-icon)').first().scrollIntoViewIfNeeded().catch(() => {});
      await page4.locator('button:has(.filter-icon)').first().click({ force: true });
      await page4.waitForTimeout(1500);
    }
    await page4.locator('input[name="filterexternalReferenceId"]').waitFor({ state: 'visible', timeout: 8_000 });
    await page4.locator('input[name="filterexternalReferenceId"]').click({ clickCount: 3 });
    await page4.locator('input[name="filterexternalReferenceId"]').fill(orderId);
    await page4.locator('button.btn-app-primary').filter({ hasText: /^Search$/ }).first().click();
    await page4.waitForTimeout(2500);

    const statusRow     = page4.locator('tbody tr').filter({ hasText: orderId }).first();
    expect(await statusRow.count(), `Order ${orderId} not found in Stock Allocation list`).toBeGreaterThan(0);
    const deliveredText = ((await statusRow.locator('td').nth(6).textContent().catch(() => '')) ?? '').trim();
    expect(deliveredText, `Expected Delivered status, got "${deliveredText}"`).toBe('Delivered');
    console.log(`[STEP 3] Stock Allocation status confirmed: Delivered`);

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 4  Nigeria2 — Verify order in POS Primary Sales
    // ─────────────────────────────────────────────────────────────────────────

    // Navigate via dashboard first — forces Angular to rebuild the POS component
    await jsNavTo(page2, '#/dashboard');
    await page2.waitForTimeout(1000);
    await jsNavTo(page2, '#/pos/primarysales');
    await page2.waitForLoadState('networkidle');
    await page2.waitForTimeout(3000);

    // Filter
    await page2.locator('button:has(.filter-icon)').first().waitFor({ state: 'visible', timeout: 20_000 });
    const posFilterOpen = await page2.locator('#sixdee_field_input_orderId').isVisible().catch(() => false);
    if (!posFilterOpen) {
      await page2.locator('button:has(.filter-icon)').first().scrollIntoViewIfNeeded().catch(() => {});
      await page2.locator('button:has(.filter-icon)').first().click({ force: true });
      await page2.waitForTimeout(1500);
    }
    await page2.locator('#sixdee_field_input_orderId').waitFor({ state: 'visible', timeout: 8_000 });
    await page2.locator('#sixdee_field_input_orderId').click({ clickCount: 3 });
    await page2.locator('#sixdee_field_input_orderId').fill(orderId);
    await page2.locator('button.btn-app-primary').filter({ hasText: /^Search$/ }).first().click();
    await page2.waitForTimeout(2500);

    expect(await page2.locator('tbody tr').count(), `Order ${orderId} not found in POS list`).toBeGreaterThan(0);

    // Eye button — CSS hover-only element, must use page.mouse.click with boundingBox
    const firstPosRow = page2.locator('tbody tr').first();
    await firstPosRow.hover();
    await page2.waitForTimeout(800);
    const eyeBtn = page2.locator('.btn-outline-primary-icon').first();
    const box    = await eyeBtn.boundingBox();
    if (!box) throw new Error('Eye button bounding box not available');
    await page2.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page2.waitForTimeout(3000);
    await page2.locator('[class*="order-detail"]').first().waitFor({ state: 'visible', timeout: 10_000 });

    // Actions → Track Order  (button is hidden in dropdown — JS click required)
    await page2.locator('button.btn-actions').filter({ hasText: /^Actions$/ }).first().waitFor({ state: 'visible', timeout: 10_000 });
    await page2.locator('button.btn-actions').filter({ hasText: /^Actions$/ }).first().click();
    await page2.waitForTimeout(1500);
    await page2.locator('button.trackOrder').first().evaluate((el) => (el as HTMLElement).click());
    await page2.waitForLoadState('networkidle');
    await page2.waitForTimeout(3000);

    // Assert Order Status = "Completed"
    const kn    = await page2.locator('.key-name').allTextContents().catch(() => [] as string[]);
    const kv    = await page2.locator('.key-value').allTextContents().catch(() => [] as string[]);
    const osIdx = kn.findIndex(n => /order\s*status/i.test(n));
    const orderStatus = osIdx >= 0 ? (kv[osIdx] ?? '').trim() : '';
    expect(orderStatus, 'Expected Order Status "Completed" in Track Order panel').toBe('Completed');

    // External ID link → expand milestone panel
    await page2.locator('a.link-action').first().click();
    await page2.waitForLoadState('networkidle');
    await page2.waitForTimeout(2000);

    // Assert all 5 milestones active
    for (const ms of ['Order Placed', 'Order Approved', 'Stock Allocated', 'Invoice Generated', 'Items Delivered']) {
      const activeEl = page2.locator('li.milestone-item.active').filter({ hasText: ms });
      expect(await activeEl.count(), `Milestone "${ms}" is not active`).toBeGreaterThan(0);
      console.log(`[STEP 4] Milestone "${ms}" ✓`);
    }

    // Back to POS list — verify Order / Delivery / Invoice statuses
    await jsNavTo(page2, '#/dashboard');
    await page2.waitForTimeout(1000);
    await jsNavTo(page2, '#/pos/primarysales');
    await page2.waitForLoadState('networkidle');
    await page2.waitForTimeout(3000);

    await page2.locator('button:has(.filter-icon)').first().waitFor({ state: 'visible', timeout: 20_000 });
    const posFilterOpen2 = await page2.locator('#sixdee_field_input_orderId').isVisible().catch(() => false);
    if (!posFilterOpen2) {
      await page2.locator('button:has(.filter-icon)').first().scrollIntoViewIfNeeded().catch(() => {});
      await page2.locator('button:has(.filter-icon)').first().click({ force: true });
      await page2.waitForTimeout(1500);
    }
    await page2.locator('#sixdee_field_input_orderId').waitFor({ state: 'visible', timeout: 8_000 });
    await page2.locator('#sixdee_field_input_orderId').click({ clickCount: 3 });
    await page2.locator('#sixdee_field_input_orderId').fill(orderId);
    await page2.locator('button.btn-app-primary').filter({ hasText: /^Search$/ }).first().click();
    await page2.waitForTimeout(2500);

    expect(await page2.locator('tbody tr').count(), `Order ${orderId} not found for final status check`).toBeGreaterThan(0);

    const finalRow   = page2.locator('tbody tr').first();
    const orderSt    = ((await finalRow.locator('td').nth(8).textContent().catch(() => '')) ?? '').trim();
    const deliverySt = ((await finalRow.locator('td').nth(9).textContent().catch(() => '')) ?? '').trim();
    const invoiceSt  = ((await finalRow.locator('td').nth(10).textContent().catch(() => '')) ?? '').trim();

    console.log(`[STEP 4] List statuses — Order: "${orderSt}" | Delivery: "${deliverySt}" | Invoice: "${invoiceSt}"`);
    expect(orderSt,    'Expected Order Status COMPLETED').toBe('COMPLETED');
    expect(deliverySt, 'Expected Delivery Status DELIVERED').toBe('DELIVERED');
    expect(invoiceSt,  'Expected Invoice Status GENERATED').toBe('GENERATED');

  } finally {
    await ctx2.close().catch(() => {});
    await ctx3.close().catch(() => {});
    await ctx4.close().catch(() => {});
  }
});
