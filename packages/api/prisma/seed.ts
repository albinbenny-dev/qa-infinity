import 'dotenv/config';
import {
  PrismaClient,
  GlobalRole,
  ProjectRole,
  TestCaseType,
  TestCaseStatus,
  Priority,
} from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// ── Helpers ────────────────────────────────────────────────────────────────
const steps = (...s: string[]) => JSON.stringify(s);
const tags = (...t: string[]) => JSON.stringify(t);

async function upsertEnvs(
  projectId: string,
  envList: { name: string; baseUrl: string; isDefault: boolean }[],
) {
  for (const env of envList) {
    await prisma.envConfig.upsert({
      where: { projectId_name: { projectId, name: env.name } },
      update: { baseUrl: env.baseUrl, isDefault: env.isDefault },
      create: { projectId, ...env },
    });
  }
}

async function upsertTCs(
  projectId: string,
  tcs: Parameters<typeof prisma.testCase.create>[0]['data'][],
) {
  for (const tc of tcs) {
    await prisma.testCase.upsert({
      where: { projectId_tcId: { projectId, tcId: tc.tcId as string } },
      update: {},
      create: { ...(tc as any), projectId },
    });
  }
}

async function seedReqDocs(
  projectId: string,
  docs: { filename: string; fileType: string }[],
) {
  const existing = await prisma.requirementDoc.count({ where: { projectId } });
  if (existing > 0) {
    console.log('   ℹ️  RequirementDocs already exist — skipping');
    return;
  }
  await prisma.requirementDoc.createMany({
    data: docs.map((d) => ({
      projectId,
      filename: d.filename,
      filePath: `/requirements/${projectId}/${d.filename}`,
      fileType: d.fileType,
      isActive: true,
    })),
  });
  console.log(`   ✅  ${docs.length} RequirementDoc(s) seeded`);
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log('\n🌱  Seeding QA Infinity — Airtel Africa / Zain Sudan\n');

  // ── Admin user ─────────────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash('admin123', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@qa-infinity.local' },
    update: {},
    create: {
      email: 'admin@qa-infinity.local',
      name: 'QA Admin',
      passwordHash,
      globalRole: GlobalRole.SUPER_ADMIN,
    },
  });
  console.log('✅  Admin user:', admin.email);

  // ════════════════════════════════════════════════════════════════════════════
  // PROJECT 1 — Airtel Ventas Local Lab
  // Sales & Distribution platform — local development environment
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n📦  Project 1: Airtel Ventas Local Lab');

  const ventasLocal = await prisma.project.upsert({
    where: { slug: 'airtel-ventas-local' },
    update: {},
    create: {
      name: 'Airtel Ventas Local Lab',
      slug: 'airtel-ventas-local',
      description:
        'Airtel Ventas Sales & Distribution platform — local lab environment. Covers primary sales, stock management, dealer onboarding & KYC flows.',
      baseUrl: 'http://ventas-local.airtel.internal',
      color: '#22d3ee',
      createdBy: admin.id,
    },
  });

  await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId: ventasLocal.id, userId: admin.id } },
    update: {},
    create: { projectId: ventasLocal.id, userId: admin.id, role: ProjectRole.ADMIN },
  });

  await upsertEnvs(ventasLocal.id, [
    { name: 'Local',   baseUrl: 'http://ventas-local.airtel.internal',    isDefault: true  },
    { name: 'QA',      baseUrl: 'http://ventas-qa.airtel.internal',        isDefault: false },
    { name: 'Dev',     baseUrl: 'http://ventas-dev.airtel.internal',       isDefault: false },
  ]);
  console.log('   ✅  Environments: Local (default) / QA / Dev');

  // ── TestCases ──────────────────────────────────────────────────────────────
  await upsertTCs(ventasLocal.id, [

    // ── UseCase: Primary Sales ───────────────────────────────────────────────
    {
      tcId: 'TC-VL-001',
      title: 'Place a primary sales order for airtime stock',
      description:
        'Verify a distributor can submit a primary sales order for airtime denominations and the order is accepted with PENDING_APPROVAL status.',
      steps: steps(
        'Login as a registered distributor (e.g., dist001@airtel.local)',
        'Navigate to Sales → Primary Sales → New Order',
        'Select product: "Airtime KES 50" from the product catalogue',
        'Enter quantity: 500 units',
        'Review order summary (value = KES 25,000 + 16% VAT)',
        'Click "Submit Order"',
      ),
      expectedResult:
        'Order reference generated (format: PS-YYYYMMDD-NNNN). Order status = PENDING_APPROVAL. ' +
        'Distributor dashboard shows order in "Awaiting Approval" list. Territory Manager receives approval notification.',
      type: TestCaseType.UI,
      tags: tags('smoke', 'primary-sales', 'order'),
      useCaseTag: 'Primary Sales',
      status: TestCaseStatus.APPROVED,
      priority: Priority.CRITICAL,
      sourceRef: 'seed:ventas-local',
    },
    {
      tcId: 'TC-VL-002',
      title: 'Approve and dispatch a pending primary sales order',
      description:
        'Verify a Territory Manager can approve a PENDING_APPROVAL order, triggering stock dispatch and inventory deduction.',
      steps: steps(
        'Login as Territory Manager (tm001@airtel.local)',
        'Navigate to Orders → Pending Approval',
        'Open order ref created in TC-VL-001',
        'Review line items, distributor credit balance, and stock availability',
        'Click "Approve Order"',
        'Set Dispatch Date to today and Dispatch From = Nairobi Central Warehouse',
        'Confirm dispatch',
      ),
      expectedResult:
        'Order status changes to DISPATCHED. Nairobi Central Warehouse stock reduces by 500 units. ' +
        'Dispatch note PDF generated. Distributor receives SMS: "Your order PS-XXXXXX has been dispatched."',
      type: TestCaseType.UI,
      tags: tags('regression', 'primary-sales', 'approval', 'dispatch'),
      useCaseTag: 'Primary Sales',
      status: TestCaseStatus.APPROVED,
      priority: Priority.CRITICAL,
      sourceRef: 'seed:ventas-local',
    },
    {
      tcId: 'TC-VL-003',
      title: 'Reject a primary sales order with a mandatory reason',
      description:
        'Verify that a Territory Manager can reject an order and a reason is mandatory, and the distributor is notified.',
      steps: steps(
        'Login as Territory Manager',
        'Navigate to Orders → Pending Approval',
        'Open a pending order',
        'Click "Reject"',
        'Attempt to submit rejection without entering a reason — expect validation error',
        'Enter reason: "Distributor credit limit exceeded — current balance KES 0"',
        'Click "Confirm Rejection"',
      ),
      expectedResult:
        'Blank reason is blocked with inline validation error. ' +
        'After entering reason, order status = REJECTED. Rejection reason stored. ' +
        'Distributor receives SMS with rejection reason. Order disappears from Pending list.',
      type: TestCaseType.UI,
      tags: tags('regression', 'primary-sales', 'rejection'),
      useCaseTag: 'Primary Sales',
      status: TestCaseStatus.APPROVED,
      priority: Priority.MEDIUM,
      sourceRef: 'seed:ventas-local',
    },

    // ── UseCase: Stock Management ─────────────────────────────────────────────
    {
      tcId: 'TC-VL-004',
      title: 'Create a new stock SKU for a KES 100 airtime denomination',
      description:
        'Verify a stock administrator can create a new product SKU for the KES 100 airtime denomination with correct pricing.',
      steps: steps(
        'Login as Stock Administrator',
        'Navigate to Stock Management → Product Catalogue → Add SKU',
        'Enter SKU Name: "Airtime KES 100"',
        'Set Denomination: 100, Currency: KES, Unit Cost: 88 (12% margin)',
        'Assign category: "Airtime" and region availability: "All Regions"',
        'Click Save',
      ),
      expectedResult:
        'New SKU created with auto-generated SKU code (e.g., AIR-100-KES). ' +
        'Product appears in the catalogue and is selectable on new order forms.',
      type: TestCaseType.UI,
      tags: tags('smoke', 'stock', 'sku'),
      useCaseTag: 'Stock Management',
      status: TestCaseStatus.APPROVED,
      priority: Priority.HIGH,
      sourceRef: 'seed:ventas-local',
    },
    {
      tcId: 'TC-VL-005',
      title: 'Initiate stock transfer between regional distributors',
      description:
        'Verify a stock administrator can request a lateral stock transfer from one regional distributor to another.',
      steps: steps(
        'Navigate to Stock Management → Stock Transfer → New Transfer',
        'Source: Nairobi Hub (distributor code: NH-001)',
        'Destination: Mombasa Hub (distributor code: MH-002)',
        'Product: Airtime KES 50, Quantity: 200 units',
        'Enter transfer justification note',
        'Click Submit Transfer Request',
      ),
      expectedResult:
        'Transfer request created (ref: STK-TRF-NNNN). Nairobi Hub shows 200 units in "Reserved — Transfer Pending". ' +
        'Mombasa Hub sees incoming transfer in their pending receipts. Both parties notified.',
      type: TestCaseType.UI,
      tags: tags('regression', 'stock', 'transfer'),
      useCaseTag: 'Stock Management',
      status: TestCaseStatus.APPROVED,
      priority: Priority.MEDIUM,
      sourceRef: 'seed:ventas-local',
    },
    {
      tcId: 'TC-VL-006',
      title: 'Generate and verify a real-time stock balance report by region',
      description:
        'Verify the stock dashboard accurately reflects opening stock, receipts, dispatches, and closing balance per SKU.',
      steps: steps(
        'Navigate to Reports → Stock Balance',
        'Select Region: Nairobi, Date: Today',
        'Click "Generate Report"',
        'Cross-check one SKU row against known dispatch records from TC-VL-002',
      ),
      expectedResult:
        'Report renders within 5 seconds. Each row shows SKU Code, Opening Stock, Received, Dispatched, Closing Balance. ' +
        'Airtime KES 50 closing balance = Opening − 500 (from TC-VL-002 dispatch). Report can be exported to Excel.',
      type: TestCaseType.UI,
      tags: tags('regression', 'stock', 'reports'),
      useCaseTag: 'Stock Management',
      status: TestCaseStatus.APPROVED,
      priority: Priority.MEDIUM,
      sourceRef: 'seed:ventas-local',
    },

    // ── UseCase: Dealer Onboarding & KYC ─────────────────────────────────────
    {
      tcId: 'TC-VL-007',
      title: 'Register a new dealer with complete KYC documents',
      description:
        'Verify the dealer onboarding form captures all required fields and transitions to PENDING_KYC upon submission.',
      steps: steps(
        'Navigate to Dealer Management → New Dealer Registration',
        'Enter business name, owner national ID number, phone (07XXXXXXXX), county, and sub-county',
        'Upload National ID (front & back) as JPG — max 2 MB each',
        'Upload Certificate of Business Registration (PDF)',
        'Select parent distributor: Nairobi Hub (NH-001)',
        'Click "Submit KYC Application"',
      ),
      expectedResult:
        'Dealer account created with status PENDING_KYC and a unique Dealer Code (DLR-NNNNNN). ' +
        'KYC reviewer assigned and notified. Dealer receives SMS with their dealer code and "under review" status.',
      type: TestCaseType.UI,
      tags: tags('smoke', 'dealer', 'kyc', 'onboarding'),
      useCaseTag: 'Dealer Onboarding & KYC',
      status: TestCaseStatus.APPROVED,
      priority: Priority.HIGH,
      sourceRef: 'seed:ventas-local',
    },
    {
      tcId: 'TC-VL-008',
      title: 'Assign credit limit and tier to a KYC-approved dealer',
      description:
        'Verify a Territory Manager can assign a credit limit and tier to a dealer once KYC is approved, enabling order placement.',
      steps: steps(
        'Navigate to Dealer Management → Find dealer (filter: Status = KYC_APPROVED)',
        'Open dealer profile',
        'Navigate to Credit Management tab',
        'Set Credit Limit: KES 50,000, Credit Tier: Silver, Repayment Days: 7',
        'Click "Save & Activate"',
      ),
      expectedResult:
        'Dealer status changes to ACTIVE. Credit limit of KES 50,000 displayed on dealer profile. ' +
        'Dealer can now place primary sales orders up to their credit limit. ' +
        'Dealer receives activation SMS: "Your Airtel Ventas dealer account is active."',
      type: TestCaseType.UI,
      tags: tags('regression', 'dealer', 'credit', 'kyc'),
      useCaseTag: 'Dealer Onboarding & KYC',
      status: TestCaseStatus.APPROVED,
      priority: Priority.HIGH,
      sourceRef: 'seed:ventas-local',
    },
  ]);
  console.log('   ✅  8 TestCases: Primary Sales (3), Stock Management (3), Dealer Onboarding & KYC (2)');

  await seedReqDocs(ventasLocal.id, [
    { filename: 'HLD-Ventas-Sales-Distribution-v3.1.pdf',          fileType: 'application/pdf' },
    { filename: 'BRD-Primary-Sales-Process-v2.0.docx',             fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    { filename: 'Dealer-Onboarding-KYC-Process-Guide-v1.5.pdf',    fileType: 'application/pdf' },
  ]);

  // ════════════════════════════════════════════════════════════════════════════
  // PROJECT 2 — Airtel Ventas Pre-Prod TZ
  // Tanzania Pre-Production — TZS localisation, secondary sales, API contracts
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n📦  Project 2: Airtel Ventas Pre-Prod TZ');

  const ventasTZ = await prisma.project.upsert({
    where: { slug: 'airtel-ventas-preprod-tz' },
    update: {},
    create: {
      name: 'Airtel Ventas Pre-Prod TZ',
      slug: 'airtel-ventas-preprod-tz',
      description:
        'Airtel Tanzania — Ventas pre-production environment. Validates TZS currency localisation, secondary sales flows, commission engine, and API contract tests against the TZ instance.',
      baseUrl: 'https://ventas-preprod.airtel.tz',
      color: '#f97316',
      createdBy: admin.id,
    },
  });

  await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId: ventasTZ.id, userId: admin.id } },
    update: {},
    create: { projectId: ventasTZ.id, userId: admin.id, role: ProjectRole.ADMIN },
  });

  await upsertEnvs(ventasTZ.id, [
    { name: 'Pre-Prod TZ', baseUrl: 'https://ventas-preprod.airtel.tz',   isDefault: true  },
    { name: 'Staging TZ',  baseUrl: 'https://ventas-staging.airtel.tz',   isDefault: false },
    { name: 'Dev TZ',      baseUrl: 'http://ventas-dev-tz.airtel.internal', isDefault: false },
  ]);
  console.log('   ✅  Environments: Pre-Prod TZ (default) / Staging TZ / Dev TZ');

  await upsertTCs(ventasTZ.id, [

    // ── UseCase: Primary Sales ────────────────────────────────────────────────
    {
      tcId: 'TC-TZ-001',
      title: 'Place a primary sales order in TZS with correct VAT calculation',
      description:
        'Verify a Tanzanian distributor can place a primary sales order in TZS and that 18% VAT is correctly applied per TZ tax rules.',
      steps: steps(
        'Login as a TZ distributor (tz-dist01@airtel.tz)',
        'Navigate to Primary Sales → New Order',
        'Select product: "Airtime TZS 1,000"',
        'Enter quantity: 1,000 units (total face value = TZS 1,000,000)',
        'Verify order summary shows VAT (18%) = TZS 152,542 and total payable = TZS 1,152,542',
        'Submit order',
      ),
      expectedResult:
        'Order ref generated (format: TZPS-YYYYMMDD-NNNN). VAT calculated at 18% inclusive. ' +
        'TRA (Tanzania Revenue Authority) invoice number appended to order record.',
      type: TestCaseType.UI,
      tags: tags('smoke', 'primary-sales', 'tz-localisation', 'vat'),
      useCaseTag: 'Primary Sales',
      status: TestCaseStatus.APPROVED,
      priority: Priority.CRITICAL,
      sourceRef: 'seed:ventas-tz',
    },
    {
      tcId: 'TC-TZ-002',
      title: 'Bulk order import via Excel template — multi-product',
      description:
        'Verify a distributor can submit a multi-product primary sales order using the Excel bulk import template.',
      steps: steps(
        'Navigate to Primary Sales → Bulk Import',
        'Download the official Ventas Bulk Order Template (.xlsx)',
        'Fill in 5 rows: different SKUs with quantities (Airtime 500, 1000, 2000, Data 1GB ×200, Data 5GB ×50)',
        'Upload the completed file',
        'Review the parsed validation summary (all 5 rows valid)',
        'Submit bulk order',
      ),
      expectedResult:
        '5 line items correctly parsed. Consolidated bulk order reference generated. ' +
        'Individual line-item status visible in order detail. Total payable shown in TZS with VAT.',
      type: TestCaseType.UI,
      tags: tags('regression', 'primary-sales', 'bulk-import'),
      useCaseTag: 'Primary Sales',
      status: TestCaseStatus.APPROVED,
      priority: Priority.HIGH,
      sourceRef: 'seed:ventas-tz',
    },

    // ── UseCase: Secondary Sales ──────────────────────────────────────────────
    {
      tcId: 'TC-TZ-003',
      title: 'Dealer places secondary sales order to a registered retailer',
      description:
        'Verify a Tanzanian dealer can place a secondary sales order to a retailer within their network, with dealer margin applied.',
      steps: steps(
        'Login as Dealer (tz-dealer01@airtel.tz)',
        'Navigate to Secondary Sales → New Order',
        'Search and select registered retailer: RTL-TZ-0042 (Dar es Salaam)',
        'Add: Airtime TZS 500 × 100 units',
        'Verify dealer selling price reflects the configured 15% margin over cost',
        'Submit order',
      ),
      expectedResult:
        'Secondary order placed. Dealer margin (15%) shown on order summary. ' +
        'Retailer receives pending delivery notification. Commission entry created in dealer ledger.',
      type: TestCaseType.UI,
      tags: tags('smoke', 'secondary-sales', 'dealer', 'retailer'),
      useCaseTag: 'Secondary Sales',
      status: TestCaseStatus.APPROVED,
      priority: Priority.HIGH,
      sourceRef: 'seed:ventas-tz',
    },
    {
      tcId: 'TC-TZ-004',
      title: 'Verify dealer commission calculation and ledger entry on secondary sales',
      description:
        'Validate that the commission engine correctly calculates and records dealer commission after a completed secondary sale.',
      steps: steps(
        'Complete a secondary sales order (ref from TC-TZ-003)',
        'Navigate to Dealer Dashboard → Commission Summary → Current Month',
        'Locate the transaction matching the completed order',
        'Verify: Commission = Order Value × 15%, withholding tax (5%) deducted, net commission in TZS',
        'Check that the ledger balance has been updated',
      ),
      expectedResult:
        'Commission row present with correct gross amount, 5% withholding tax, and net payout in TZS. ' +
        'Running balance updated. Commission payout scheduled for month-end.',
      type: TestCaseType.UI,
      tags: tags('regression', 'secondary-sales', 'commission', 'ledger'),
      useCaseTag: 'Secondary Sales',
      status: TestCaseStatus.APPROVED,
      priority: Priority.MEDIUM,
      sourceRef: 'seed:ventas-tz',
    },

    // ── UseCase: Sales API ────────────────────────────────────────────────────
    {
      tcId: 'TC-TZ-005',
      title: 'POST /api/v1/orders — create a TZ sales order via API',
      description:
        'Verify the Ventas Orders API accepts a valid TZ sales order payload, applies TZS currency rules, and returns HTTP 201.',
      steps: steps(
        'Authenticate: POST /api/v1/auth/token with TZ distributor credentials',
        'Extract bearer token from 200 response',
        'POST /api/v1/orders with body: { distributorId, currency: "TZS", lineItems: [{skuCode: "AIR-1000-TZS", qty: 500}] }',
        'Assert HTTP status = 201',
        'Assert response: { orderRef, currency: "TZS", vatRate: 0.18, vatAmount, totalPayable, status: "PENDING_APPROVAL" }',
      ),
      expectedResult:
        'HTTP 201 Created. All monetary fields in TZS. vatAmount = totalPayable × 18/118. ' +
        'orderRef follows TZPS-YYYYMMDD-NNNN format. status = PENDING_APPROVAL.',
      type: TestCaseType.API,
      tags: tags('smoke', 'api', 'orders', 'tz-localisation'),
      useCaseTag: 'Sales API',
      status: TestCaseStatus.APPROVED,
      priority: Priority.HIGH,
      sourceRef: 'seed:ventas-tz',
    },
    {
      tcId: 'TC-TZ-006',
      title: 'GET /api/v1/stock/balance — retrieve real-time stock by TZ region',
      description:
        'Verify the Stock Balance API returns accurate, real-time stock per SKU for a specified Tanzania region.',
      steps: steps(
        'Authenticate and obtain bearer token',
        'GET /api/v1/stock/balance?region=DAR_ES_SALAAM',
        'Assert HTTP status = 200',
        'Assert each item in the array has: { skuCode, skuName, openingBalance, received, dispatched, closingBalance, currency: "TZS", asOf: <ISO timestamp> }',
        'Verify asOf timestamp is within the last 60 seconds (real-time data)',
      ),
      expectedResult:
        'HTTP 200 OK. Stock array contains all active TZS SKUs for Dar es Salaam. ' +
        'closingBalance = openingBalance + received − dispatched. asOf within 60s of request time.',
      type: TestCaseType.API,
      tags: tags('smoke', 'api', 'stock', 'tz-localisation'),
      useCaseTag: 'Sales API',
      status: TestCaseStatus.APPROVED,
      priority: Priority.HIGH,
      sourceRef: 'seed:ventas-tz',
    },
  ]);
  console.log('   ✅  6 TestCases: Primary Sales (2), Secondary Sales (2), Sales API (2)');

  await seedReqDocs(ventasTZ.id, [
    { filename: 'PRD-Ventas-TZ-Localisation-v1.0.pdf',       fileType: 'application/pdf' },
    { filename: 'TZ-Tax-Integration-Spec-TRA-v1.2.docx',     fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  ]);

  // ════════════════════════════════════════════════════════════════════════════
  // PROJECT 3 — Zain Sudan Magik
  // Customer Value Management & Loyalty platform
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n📦  Project 3: Zain Sudan Magik');

  const zainMagik = await prisma.project.upsert({
    where: { slug: 'zain-sudan-magik' },
    update: {},
    create: {
      name: 'Zain Sudan Magik',
      slug: 'zain-sudan-magik',
      description:
        'Zain Sudan — Magik CVM & Loyalty platform QA suite. Covers loyalty points lifecycle, campaign management, retention offers, and CVM API contract tests in SDG currency.',
      baseUrl: 'https://magik-preprod.zain.sd',
      color: '#a78bfa',
      createdBy: admin.id,
    },
  });

  await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId: zainMagik.id, userId: admin.id } },
    update: {},
    create: { projectId: zainMagik.id, userId: admin.id, role: ProjectRole.ADMIN },
  });

  await upsertEnvs(zainMagik.id, [
    { name: 'Pre-Prod SD', baseUrl: 'https://magik-preprod.zain.sd',    isDefault: true  },
    { name: 'QA SD',       baseUrl: 'https://magik-qa.zain.sd',         isDefault: false },
    { name: 'Dev SD',      baseUrl: 'http://magik-dev.zain.internal',   isDefault: false },
  ]);
  console.log('   ✅  Environments: Pre-Prod SD (default) / QA SD / Dev SD');

  await upsertTCs(zainMagik.id, [

    // ── UseCase: Points & Rewards ─────────────────────────────────────────────
    {
      tcId: 'TC-ZS-001',
      title: 'Customer earns Magik loyalty points on mobile recharge',
      description:
        'Verify that a Zain subscriber earns the correct number of Magik loyalty points upon completing a mobile recharge, and points reflect instantly in the loyalty wallet.',
      steps: steps(
        'Login to Zain Sudan self-care portal as subscriber (MSISDN: 249912345678)',
        'Navigate to Wallet → Recharge',
        'Enter recharge amount: SDG 100',
        'Select payment method: Zain Cash',
        'Complete recharge and wait for confirmation',
        'Navigate to Loyalty → My Points',
      ),
      expectedResult:
        '100 Magik points credited (earn rate: 1 point per SDG). ' +
        'Points balance reflected within 30 seconds of recharge confirmation. ' +
        'SMS notification: "You earned 100 Magik points! Balance: XXXX pts." ' +
        'Transaction visible in points history with timestamp.',
      type: TestCaseType.UI,
      tags: tags('smoke', 'loyalty', 'points', 'recharge'),
      useCaseTag: 'Points & Rewards',
      status: TestCaseStatus.APPROVED,
      priority: Priority.CRITICAL,
      sourceRef: 'seed:zain-magik',
    },
    {
      tcId: 'TC-ZS-002',
      title: 'Customer redeems Magik points for a free data bundle',
      description:
        'Verify a subscriber with sufficient points balance can redeem points for a free data bundle, and the bundle is instantly provisioned on the account.',
      steps: steps(
        'Login as subscriber with at least 200 Magik points balance',
        'Navigate to Loyalty → Rewards Catalogue',
        'Select reward: "500MB Data Bundle" (200 points)',
        'Click "Redeem"',
        'Confirm redemption on the summary screen',
        'Check active data bundles on the account',
      ),
      expectedResult:
        '200 Magik points deducted from balance. 500MB data bundle activated on MSISDN within 60 seconds. ' +
        'Redemption confirmation SMS sent. ' +
        'Transaction visible in redemption history with status = COMPLETED.',
      type: TestCaseType.UI,
      tags: tags('smoke', 'loyalty', 'points', 'redemption', 'data-bundle'),
      useCaseTag: 'Points & Rewards',
      status: TestCaseStatus.APPROVED,
      priority: Priority.HIGH,
      sourceRef: 'seed:zain-magik',
    },

    // ── UseCase: Campaign Management ─────────────────────────────────────────
    {
      tcId: 'TC-ZS-003',
      title: 'Create a targeted bonus-points campaign for High Value Customers',
      description:
        'Verify a CVM administrator can create and publish a bonus-points campaign targeting the HVC segment with a 2× multiplier on recharges above SDG 200.',
      steps: steps(
        'Login as CVM Admin',
        'Navigate to Campaign Management → New Campaign',
        'Name: "Ramadan HVC Bonus", Type: Bonus Points',
        'Target segment: High Value Customers (HVC)',
        'Rule: 2× points multiplier on recharges ≥ SDG 200',
        'Set validity: Current month (start/end dates)',
        'Set budget cap: 50,000 bonus points total',
        'Click Publish',
      ),
      expectedResult:
        'Campaign created with status = ACTIVE and a unique campaign ID. ' +
        'HVC segment subscribers auto-enrolled (enrollment count visible). ' +
        'Campaign appears in the active campaign list. ' +
        'Budget tracker shows 0 / 50,000 points awarded.',
      type: TestCaseType.UI,
      tags: tags('smoke', 'campaign', 'cvm', 'hvc'),
      useCaseTag: 'Campaign Management',
      status: TestCaseStatus.APPROVED,
      priority: Priority.HIGH,
      sourceRef: 'seed:zain-magik',
    },
    {
      tcId: 'TC-ZS-004',
      title: 'Validate campaign exclusion rules prevent duplicate enrollment',
      description:
        'Verify the CVM engine enforces exclusion rules when a subscriber is already enrolled in a conflicting campaign.',
      steps: steps(
        'Enroll subscriber (249912345678) in Campaign A (Ramadan HVC Bonus) — confirm enrollment',
        'Attempt to enroll the same subscriber in Campaign B which has a mutual-exclusion rule against Campaign A',
        'Observe the API or UI response',
        'Check subscriber campaign list via CVM Admin → Subscriber Lookup',
      ),
      expectedResult:
        'Enrollment in Campaign B is rejected. Error code CVM-4091: "Subscriber already enrolled in an exclusive campaign." ' +
        'Subscriber remains in Campaign A only. ' +
        'Conflict event logged in campaign audit trail.',
      type: TestCaseType.SIT,
      tags: tags('regression', 'campaign', 'exclusion', 'cvm'),
      useCaseTag: 'Campaign Management',
      status: TestCaseStatus.APPROVED,
      priority: Priority.MEDIUM,
      sourceRef: 'seed:zain-magik',
    },

    // ── UseCase: Customer Value Management ───────────────────────────────────
    {
      tcId: 'TC-ZS-005',
      title: 'GET /api/cvm/customers/:msisdn/profile — fetch 360 loyalty profile',
      description:
        'Verify the CVM API returns a complete 360° loyalty profile for a subscriber including tier, points balance, enrolled campaigns, and redemption history.',
      steps: steps(
        'Authenticate as system integration user via POST /api/cvm/auth/token',
        'GET /api/cvm/customers/249912345678/profile',
        'Assert HTTP 200',
        'Assert response body contains all required fields',
        'Verify points balance matches the subscriber\'s known balance from previous transactions',
      ),
      expectedResult:
        'HTTP 200 OK. Response: { msisdn, tier: "Gold"|"Silver"|"Bronze", pointsBalance, lifetimePoints, ' +
        'enrolledCampaigns: [{id, name, enrolledAt}], redemptionHistory: [{reward, pointsUsed, redeemedAt}], ' +
        'lastActivity: <ISO timestamp> }. All monetary amounts in SDG.',
      type: TestCaseType.API,
      tags: tags('smoke', 'api', 'cvm', 'loyalty-profile'),
      useCaseTag: 'Customer Value Management',
      status: TestCaseStatus.APPROVED,
      priority: Priority.HIGH,
      sourceRef: 'seed:zain-magik',
    },
    {
      tcId: 'TC-ZS-006',
      title: 'Assign a retention offer to at-risk subscriber segment via API',
      description:
        'Verify the CVM engine can assign a pre-configured retention offer to all subscribers in the AT_RISK churn segment in a single API call, with push notification triggered.',
      steps: steps(
        'Authenticate as CVM system user',
        'POST /api/cvm/offers/assign with body: { segmentId: "AT_RISK", offerId: "RETENTION_BONUS_50", validityDays: 7 }',
        'Assert HTTP 202 Accepted with a job ID',
        'Poll GET /api/cvm/jobs/:jobId until status = COMPLETED (max 30s)',
        'Assert assignment summary: { totalEligible, assigned, failed }',
        'Verify one at-risk subscriber\'s profile shows the offer in their active offers list',
      ),
      expectedResult:
        'HTTP 202 Accepted immediately. Job completes within 30 seconds. ' +
        'All eligible AT_RISK subscribers assigned the RETENTION_BONUS_50 offer for 7 days. ' +
        'OCS push notification triggered for each subscriber. ' +
        'Campaign audit trail records the bulk assignment with timestamp and job ID.',
      type: TestCaseType.SIT,
      tags: tags('regression', 'api', 'cvm', 'retention', 'churn'),
      useCaseTag: 'Customer Value Management',
      status: TestCaseStatus.APPROVED,
      priority: Priority.HIGH,
      sourceRef: 'seed:zain-magik',
    },
  ]);
  console.log('   ✅  6 TestCases: Points & Rewards (2), Campaign Management (2), Customer Value Management (2)');

  await seedReqDocs(zainMagik.id, [
    { filename: 'HLD-Magik-CVM-Loyalty-Platform-v1.4.pdf',         fileType: 'application/pdf' },
    { filename: 'API-Spec-CVM-Microservices-v2.2.xlsx',            fileType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    { filename: 'Loyalty-Points-Engine-Business-Rules-v1.0.docx',  fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  ]);

  // ── Final summary ──────────────────────────────────────────────────────────
  console.log('\n🎉  Seed complete!\n');
  console.log('   ┌─────────────────────────────────────────────────────────┐');
  console.log('   │  Login:    admin@qa-infinity.local                      │');
  console.log('   │  Password: admin123                                     │');
  console.log('   ├─────────────────────────────────────────────────────────┤');
  console.log('   │  1. Airtel Ventas Local Lab   → /airtel-ventas-local    │');
  console.log('   │     8 TCs (Primary Sales / Stock Mgmt / Dealer KYC)    │');
  console.log('   │  2. Airtel Ventas Pre-Prod TZ → /airtel-ventas-preprod-tz │');
  console.log('   │     6 TCs (Primary Sales / Secondary Sales / API)      │');
  console.log('   │  3. Zain Sudan Magik          → /zain-sudan-magik       │');
  console.log('   │     6 TCs (Points / Campaigns / CVM API)               │');
  console.log('   └─────────────────────────────────────────────────────────┘\n');
}

main()
  .catch((err) => {
    console.error('\n❌  Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
