import 'dotenv/config';
import { PrismaClient, GlobalRole, ProjectRole, TestCaseType, TestCaseStatus, Priority } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱  Seeding QA Infinity database...\n');

  // ── Admin user ─────────────────────────────────────────────────────────
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

  // ── Projects ───────────────────────────────────────────────────────────
  const ecommerce = await prisma.project.upsert({
    where: { slug: 'ecommerce-web' },
    update: {},
    create: {
      name: 'E-Commerce Web',
      slug: 'ecommerce-web',
      description: 'End-to-end test suite for the Ventas e-commerce web platform — checkout, authentication, and order management.',
      baseUrl: 'https://qa.acme.internal',
      color: '#22d3ee',
      createdBy: admin.id,
    },
  });

  const paymentsApi = await prisma.project.upsert({
    where: { slug: 'payments-api' },
    update: {},
    create: {
      name: 'Payments API',
      slug: 'payments-api',
      description: 'API-level test suite for the payment processing microservice — integration and contract tests.',
      baseUrl: 'https://payments-qa.acme.internal',
      color: '#a78bfa',
      createdBy: admin.id,
    },
  });

  const mobileApp = await prisma.project.upsert({
    where: { slug: 'mobile-v2' },
    update: {},
    create: {
      name: 'Mobile App v2',
      slug: 'mobile-v2',
      description: 'Playwright mobile-emulation tests for the Ventas app v2 redesign across iOS and Android viewports.',
      baseUrl: 'https://mobile-qa.acme.internal',
      color: '#fbbf24',
      createdBy: admin.id,
    },
  });

  console.log('✅  3 projects created');

  // ── Admin membership on all projects ───────────────────────────────────
  for (const project of [ecommerce, paymentsApi, mobileApp]) {
    await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: project.id, userId: admin.id } },
      update: {},
      create: { projectId: project.id, userId: admin.id, role: ProjectRole.ADMIN },
    });
  }
  console.log('✅  Admin added as ADMIN to all projects');

  // ── EnvConfigs — QA (default), Staging, Dev for every project ──────────
  const envDefs = [
    { name: 'QA',      isDefault: true,  urlSuffix: 'qa' },
    { name: 'Staging', isDefault: false, urlSuffix: 'staging' },
    { name: 'Dev',     isDefault: false, urlSuffix: 'dev' },
  ];

  for (const project of [ecommerce, paymentsApi, mobileApp]) {
    for (const env of envDefs) {
      await prisma.envConfig.upsert({
        where: { projectId_name: { projectId: project.id, name: env.name } },
        update: {},
        create: {
          projectId: project.id,
          name: env.name,
          baseUrl: `https://${env.urlSuffix}.acme.internal`,
          isDefault: env.isDefault,
        },
      });
    }
  }
  console.log('✅  EnvConfigs (QA/Staging/Dev) created for all projects');

  // ── TestCases for E-Commerce Web (8 TCs across 3 use cases) ───────────
  const tcDefs = [
    // ── Checkout Flow ──────────────────────────────────────────────────
    {
      tcId: 'TC-001',
      title: 'Add item to cart and verify cart count updates',
      description: 'Ensure adding a product from the catalog increments the cart badge and persists the line item.',
      steps: JSON.stringify([
        'Navigate to the product catalog page',
        'Click "Add to Cart" on any available in-stock product',
        'Observe the cart icon in the top navigation bar',
      ]),
      expectedResult:
        'Cart badge increments by 1. Product appears in the cart drawer with the correct name, quantity, and price.',
      type: TestCaseType.UI,
      tags: JSON.stringify(['smoke', 'checkout', 'cart']),
      useCaseTag: 'Checkout Flow',
      status: TestCaseStatus.APPROVED,
      priority: Priority.HIGH,
      sourceRef: 'seed:manual',
    },
    {
      tcId: 'TC-002',
      title: 'Complete checkout with a valid credit card',
      description: 'Verify the full purchase journey from cart review through to order confirmation.',
      steps: JSON.stringify([
        'Add 2 items to the cart',
        'Click "Proceed to Checkout"',
        'Fill in a valid shipping address',
        'Enter test card 4242-4242-4242-4242, exp 12/29, CVC 123',
        'Click "Place Order"',
      ]),
      expectedResult:
        'Order confirmation page is shown with a unique order ID. Confirmation email trigger is logged.',
      type: TestCaseType.UI,
      tags: JSON.stringify(['regression', 'checkout', 'payment']),
      useCaseTag: 'Checkout Flow',
      status: TestCaseStatus.APPROVED,
      priority: Priority.CRITICAL,
      sourceRef: 'seed:manual',
    },
    {
      tcId: 'TC-003',
      title: 'Apply a valid discount coupon at checkout',
      description: 'Verify that a valid coupon code reduces the order total by the expected percentage.',
      steps: JSON.stringify([
        'Add any item to cart and navigate to checkout',
        'Locate the "Promo Code" field and enter DISCOUNT10',
        'Click "Apply Coupon"',
        'Review the updated order summary',
      ]),
      expectedResult:
        'Order total is reduced by 10%. A "Coupon applied" confirmation is displayed with the discount amount.',
      type: TestCaseType.UI,
      tags: JSON.stringify(['regression', 'checkout', 'coupon']),
      useCaseTag: 'Checkout Flow',
      status: TestCaseStatus.APPROVED,
      priority: Priority.MEDIUM,
      sourceRef: 'seed:manual',
    },

    // ── User Authentication ────────────────────────────────────────────
    {
      tcId: 'TC-004',
      title: 'Register a new user account successfully',
      description: 'Verify that a prospective user can complete registration with valid unique credentials.',
      steps: JSON.stringify([
        'Navigate to /register',
        'Fill in full name, unique email, and a password (min 8 chars)',
        'Check the "I agree to Terms & Conditions" checkbox',
        'Click "Create Account"',
      ]),
      expectedResult:
        'User is redirected to the onboarding screen. A welcome email is dispatched. Account appears in the user table.',
      type: TestCaseType.UI,
      tags: JSON.stringify(['smoke', 'auth', 'registration']),
      useCaseTag: 'User Authentication',
      status: TestCaseStatus.APPROVED,
      priority: Priority.HIGH,
      sourceRef: 'seed:manual',
    },
    {
      tcId: 'TC-005',
      title: 'Login with valid credentials',
      description: 'Verify that a registered user can authenticate using correct email and password.',
      steps: JSON.stringify([
        'Navigate to /login',
        'Enter the registered email address',
        'Enter the correct password',
        'Click "Sign In"',
      ]),
      expectedResult:
        'User is authenticated and redirected to the dashboard. A valid session cookie / JWT is issued.',
      type: TestCaseType.UI,
      tags: JSON.stringify(['smoke', 'auth', 'login']),
      useCaseTag: 'User Authentication',
      status: TestCaseStatus.APPROVED,
      priority: Priority.CRITICAL,
      sourceRef: 'seed:manual',
    },
    {
      tcId: 'TC-006',
      title: 'Forgot-password flow sends a reset email',
      description: 'Verify the forgot-password form triggers a time-limited password reset link via email.',
      steps: JSON.stringify([
        'Navigate to /forgot-password',
        'Enter a registered email address in the input field',
        'Click "Send Reset Link"',
      ]),
      expectedResult:
        'A success toast is displayed. The user receives an email with a reset link valid for 1 hour.',
      type: TestCaseType.UI,
      tags: JSON.stringify(['regression', 'auth', 'password-reset']),
      useCaseTag: 'User Authentication',
      status: TestCaseStatus.APPROVED,
      priority: Priority.MEDIUM,
      sourceRef: 'seed:manual',
    },

    // ── Order API ──────────────────────────────────────────────────────
    {
      tcId: 'TC-007',
      title: 'POST /api/v1/orders — create order returns HTTP 201',
      description: 'Verify the Orders API creates a new order when called with a valid authenticated payload.',
      steps: JSON.stringify([
        'Obtain a valid bearer token via POST /api/v1/auth/login',
        'Send POST /api/v1/orders with Authorization header and valid order payload',
        'Assert HTTP response status is 201',
        'Assert response body contains orderId (UUID), status "pending", and matching total',
      ]),
      expectedResult:
        'HTTP 201 Created. Response body: { orderId: <uuid>, status: "pending", total: <number>, lineItems: [...] }.',
      type: TestCaseType.API,
      tags: JSON.stringify(['smoke', 'api', 'orders']),
      useCaseTag: 'Order API',
      status: TestCaseStatus.APPROVED,
      priority: Priority.HIGH,
      sourceRef: 'seed:manual',
    },
    {
      tcId: 'TC-008',
      title: 'GET /api/v1/orders/:id — retrieve order by ID',
      description: 'Verify a created order can be fetched by its ID with matching details.',
      steps: JSON.stringify([
        'Create an order via POST /api/v1/orders (use TC-007 payload)',
        'Extract orderId from the 201 response',
        'Send GET /api/v1/orders/:orderId with the same auth token',
        'Assert status 200 and that response fields match the creation payload',
      ]),
      expectedResult:
        'HTTP 200 OK. Order fields (total, lineItems, status) exactly match what was sent during creation.',
      type: TestCaseType.API,
      tags: JSON.stringify(['regression', 'api', 'orders']),
      useCaseTag: 'Order API',
      status: TestCaseStatus.APPROVED,
      priority: Priority.MEDIUM,
      sourceRef: 'seed:manual',
    },
  ];

  for (const tc of tcDefs) {
    await prisma.testCase.upsert({
      where: { projectId_tcId: { projectId: ecommerce.id, tcId: tc.tcId } },
      update: {},
      create: { projectId: ecommerce.id, ...tc },
    });
  }
  console.log('✅  8 TestCases seeded for E-Commerce Web (3 Checkout Flow, 3 User Auth, 2 Order API)');

  // ── RequirementDocs for E-Commerce Web ─────────────────────────────────
  const existingDocs = await prisma.requirementDoc.count({
    where: { projectId: ecommerce.id },
  });

  if (existingDocs === 0) {
    await prisma.requirementDoc.createMany({
      data: [
        {
          projectId: ecommerce.id,
          filename: 'HLD-EComm-Web-v2.3.pdf',
          filePath: `/requirements/${ecommerce.id}/HLD-EComm-Web-v2.3.pdf`,
          fileType: 'application/pdf',
          isActive: true,
        },
        {
          projectId: ecommerce.id,
          filename: 'BRD-Checkout-Flow-v1.1.docx',
          filePath: `/requirements/${ecommerce.id}/BRD-Checkout-Flow-v1.1.docx`,
          fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          isActive: true,
        },
      ],
    });
    console.log('✅  2 RequirementDocs seeded for E-Commerce Web');
  } else {
    console.log('ℹ️   RequirementDocs already exist — skipping');
  }

  console.log('\n🎉  Seed complete!\n');
  console.log('   Login:    admin@qa-infinity.local');
  console.log('   Password: admin123\n');
}

main()
  .catch((err) => {
    console.error('❌  Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
