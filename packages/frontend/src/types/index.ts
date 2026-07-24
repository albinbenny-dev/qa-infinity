export interface User {
  id: string;
  email: string;
  name: string;
  globalRole: 'SUPER_ADMIN' | 'ADMIN' | 'SUPER_USER' | 'STANDARD_USER';
}

/** Project-level role assigned to a ProjectMember */
export type ProjectRole = 'ADMIN' | 'SUPER_USER' | 'STANDARD_USER';

export interface AuthResponse {
  token: string;
  user: User;
}

export interface Project {
  id: string;
  name: string;
  slug: string;
  description?: string;
  baseUrl?: string;
  color?: string;
  reqLibraryPath?: string;
  createdAt: string;
  createdBy: string;
  /** The authenticated user's role in this project (injected by GET /projects) */
  myRole?: ProjectRole | null;
  _count?: {
    testCases: number;
    members: number;
    runs?: number;
  };
  members?: ProjectMember[];
  envConfigs?: EnvConfig[];
  requirementDocs?: RequirementDoc[];
}

export interface ProjectMember {
  projectId: string;
  userId: string;
  role: 'ADMIN' | 'SUPER_USER' | 'STANDARD_USER';
  user: {
    id: string;
    name: string;
    email: string;
  };
}

export interface EnvConfig {
  id: string;
  projectId: string;
  name: string;
  baseUrl: string;
  username?: string | null;
  password?: string | null;
  isDefault: boolean;
}

export interface RequirementDoc {
  id: string;
  projectId: string;
  filename: string;
  filePath: string;
  fileType: string;
  isActive: boolean;
  uploadedAt: string;
}

export interface TestCase {
  id: string;
  projectId: string;
  tcId: string;
  title: string;
  description?: string;
  steps: string[];
  expectedResult?: string;
  type: 'UI' | 'API' | 'SIT';
  tags: string[];
  useCaseTag?: string;
  status: 'DRAFT' | 'APPROVED' | 'DEPRECATED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  sourceRef?: string;
  generationHints?: string | null;
  /** Runtime variables declared for this TC — captured dynamically during execution */
  runtimeVariables?: Array<{ name: string; captureFrom: string; description?: string }> | null;
  /** ID of the TC whose script covers the setup steps (login + navigation) for this TC */
  prerequisiteTcId?: string | null;
  /** Minimal info about the prerequisite TC for display */
  prerequisiteTc?: { id: string; tcId: string; title: string } | null;
  lastRun?: RunResult;
  /** Last ≤5 terminal run results, oldest → newest. Each carries the runId for navigation. */
  recentRunStatuses?: Array<{ status: 'PASSED' | 'FAILED' | 'SKIPPED' | 'CANCELLED'; runId: string }>;
}

export interface Run {
  id: string;
  projectId: string;
  runSeq: number;
  name: string;
  environment: string;
  status: 'PENDING' | 'RUNNING' | 'PASSED' | 'FAILED' | 'CANCELLED';
  startedAt?: string;
  completedAt?: string;
  triggerType: 'MANUAL' | 'SCHEDULED' | 'INDIVIDUAL' | 'GROUP' | 'HEAL_RERUN';
  createdByUserId?: string | null;
  results?: RunResult[];
}

export interface RunResult {
  id: string;
  runId: string;
  testCaseId: string;
  status: 'PENDING' | 'RUNNING' | 'PASSED' | 'FAILED' | 'CANCELLED' | 'SKIPPED';
  duration?: number;
  errorMessage?: string;
  screenshotPath?: string;
  tracePath?: string;
  videoPath?: string;
  rfLogPath?: string;
}

export interface Schedule {
  id: string;
  projectId: string;
  name: string;
  cronExpression: string;
  testCaseIds: string;
  environment: string;
  isActive: boolean;
  emailRecipients: string;
  createdAt: string;
  updatedAt: string;
}

export interface Suite {
  id: string;
  projectId: string;
  name: string;
  testCaseIds: string; // JSON string — parse with JSON.parse
  createdAt: string;
  updatedAt: string;
}

export interface Script {
  id: string;
  projectId: string;
  testCaseId?: string | null;
  filename: string;
  scriptType?: 'PLAYWRIGHT' | 'ROBOT';
  isCustomUpload: boolean;
  isGolden?: boolean;
  verificationStatus?: 'NOT_VERIFIED' | 'VERIFIED' | 'MANUAL_REVIEW';
  suspectedIssue?: string | null;
  createdAt: string;
  updatedAt: string;
  testCase?: Pick<TestCase, 'id' | 'tcId' | 'title'> & { useCaseTag?: string | null };
  lastRunStatus?: 'PASSED' | 'FAILED' | 'RUNNING' | 'PENDING' | 'CANCELLED' | null;
  size?: number | null;
  modifiedAt?: string | null;
}

export interface ProjectResource {
  id: string;
  projectId: string;
  filename: string;
  originalName: string;
  size: number;
  uploadedAt: string;
  /** Full container path: /scripts/{slug}/resources/{filename} */
  containerPath?: string;
  /** True for .xlsx, .xls, .pdf and other non-text files */
  isBinary?: boolean;
}

export type ScriptJobPhase =
  | 'QUEUED'
  | 'GENERATING'
  | 'GENERATED'
  | 'QUEUED_VERIFY'
  | 'VERIFYING'
  | 'HEALING'
  | 'VERIFIED'
  | 'MANUAL_REVIEW'
  | 'FAILED';

export interface ScriptJob {
  id: string;
  projectId: string;
  testCaseId: string;
  scriptId?: string | null;
  createdBy?: string | null;
  phase: ScriptJobPhase;
  withHeal: boolean;
  healAttempts: number;
  maxHealAttempts: number;
  lastError?: string | null;
  suspectedIssue?: string | null;
  healType?: string | null;
  createdAt: string;
  updatedAt: string;
  testCase?: { id: string; tcId: string; title: string; type?: string; useCaseTag?: string | null } | null;
  script?: { id: string; filename: string; verificationStatus?: string; suspectedIssue?: string | null } | null;
}

export interface DiffLine {
  type: 'add' | 'remove' | 'unchanged';
  line: string;
  lineNum: number;
}

export interface HealProposal {
  id: string;
  projectId: string;
  runResultId: string;
  type: 'SELECTOR' | 'FLOW' | 'API_SCHEMA';
  originalCode: string;
  patchedCode: string;
  confidence: number;
  summary?: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'AUTO_APPLIED' | 'EXHAUSTED';
  createdAt: string;
  updatedAt: string;
  lineDiff?: DiffLine[];
  runResult?: {
    id: string;
    status: string;
    errorMessage?: string | null;
    testCase: { id: string; tcId: string; title: string };
    run: { id: string; name: string; environment: string };
    script?: { id: string; filename: string; content?: string } | null;
  };
}

export interface HealStats {
  pending: number;
  approved: number;
  rejected: number;
  autoApplied: number;
  total: number;
  autoAppliedToday: number;
  selectorChanges: number;
  flowChanges: number;
  avgConfidence: number;
}

// ── Reports / Dashboard types ──────────────────────────────────────────────

export interface FlakyTest {
  id: string;
  tcId: string;
  title: string;
  passCount: number;
  failCount: number;
  recentResults: Array<'PASSED' | 'FAILED' | 'SKIPPED'>;
}

export interface ProjectStats {
  totalTests: number;
  scriptsGenerated: number;
  totalRuns: number;
  lastRunPassCount: number;
  lastRunFailCount: number;
  avgPassRate: number;
  activeSchedules: number;
  pendingHeals: number;
  flakyTests: FlakyTest[];
}

export interface RunTrendPoint {
  date: string;
  passed: number;
  failed: number;
  skipped: number;
}

export interface AgentStatus {
  name: string;
  label: string;
  status: 'ok' | 'busy' | 'idle';
  detail: string;
}

export interface TopSuiteEntry {
  name: string;
  runCount: number;
  lastRunStatuses: string[];
  successRate: number;
}

export interface DashboardData {
  stats: ProjectStats;
  trend: RunTrendPoint[];
  recentRuns: Array<{
    id: string;
    name: string;
    environment: string;
    status: string;
    triggerType: string;
    createdAt: string;
    startedAt?: string;
    completedAt?: string;
    results: Array<{ status: string }>;
    _count: { results: number };
  }>;
  agentStatuses: AgentStatus[];
  topSuites: TopSuiteEntry[];
  projectTokens: number;
}

export interface AIAnalysis {
  summary: string;
  rootCauses: string[];
  recommendations: string[];
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface ReportRecord {
  id: string;
  projectId: string;
  runId: string;
  summary: string;
  aiAnalysis: string; // JSON string of AIAnalysis
  emailSentAt?: string | null;
  createdAt: string;
}

export interface ReportRun {
  id: string;
  projectId: string;
  runSeq: number;
  name: string;
  environment: string;
  status: string;
  triggerType: string;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  results: Array<{
    id: string;
    status: 'PENDING' | 'RUNNING' | 'PASSED' | 'FAILED' | 'CANCELLED' | 'SKIPPED';
    duration?: number | null;
    errorMessage?: string | null;
    screenshotPath?: string | null;
    tracePath?: string | null;
    videoPath?: string | null;
    rfLogPath?: string | null;
    testCase: { id: string; tcId: string; title: string; type: string; useCaseTag?: string | null };
  }>;
  _count: { results: number };
  report?: ReportRecord | null;
}

export interface EmailConfig {
  recipients: string[];
  triggerEvents: string[];
}

export type NavItem = {
  label: string;
  path: string;
  icon: string;
  badge?: string | number;
  badgeVariant?: 'red' | 'green' | 'blue';
};

export type NavSection = {
  label: string;
  items: NavItem[];
};

// ── Chat types ─────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  projectId: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  actionType?: string | null;
  actionPayload?: string | null; // JSON string — parse before use
  attachments?: string | null;  // JSON: [{name, mimeType}]
  createdAt: string;
}

export interface ChatMemory {
  id: string;
  projectId: string;
  content: string;
  createdAt: string;
}

export interface ChatAttachment {
  name: string;
  mimeType: string;
  data: string; // base64
}

// ── UI Scanner types ───────────────────────────────────────────────────────

export interface UIScan {
  id: string;
  projectId: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  triggeredBy: string;
  startedAt: string | null;
  completedAt: string | null;
  progress: number;
  currentPage: string | null;
  pagesTotal: number;
  pagesScanned: number;
  errorMessage: string | null;
  createdAt: string;
}

export interface ScanDraftTC {
  title: string;
  description?: string;
  steps: string[];
  expectedResult: string;
  type: 'UI' | 'API' | 'SIT';
  tags?: string[];
  useCaseTag: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  sourceRef?: string;
}

export interface ProjectContext {
  id: string;
  projectId: string;
  loginInstructions: LoginInstructions | null;
  navigationMap: NavNode[] | null;
  pageLocators: Record<string, PageLocators> | null;
  useCaseSummary: UseCaseSummary[] | null;
  customInstructions: string | null;
  pendingTCDraft: ScanDraftTC[] | null;
  lastScanId: string | null;
  updatedAt: string;
}

export interface LoginInstructions {
  steps: LoginStep[];
  selectors: { username: string; password: string; submit: string };
  loginType: 'standard' | 'two-step' | 'sso';
  postLoginUrl: string;
  notes: string;
}

export interface LoginStep {
  order: number;
  description: string;
  selector?: string;
  action: 'navigate' | 'fill' | 'click' | 'assert';
}

export interface NavNode {
  label: string;
  url: string;
  urlPattern: string;
  children: NavNode[];
  pageType: string;
  depth: number;
}

export interface PageLocators {
  urlPattern: string;
  navLabel: string;
  locators: Array<{ semanticName: string; selector: string; locatorType: string }>;
}

export interface UseCaseSummary {
  name: string;
  color: string;
  pages: string[];
  tcCount: number;
}

// ── Agentic Browser Trace ──────────────────────────────────────────────────

export interface AgentTraceStep {
  stepNumber: number;
  toolName: string;
  stepDescription?: string;
  success: boolean;
  errorMessage?: string;
}

export interface AgentTrace {
  id: string;
  projectId: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'BLOCKED';
  testGoal: string;
  menuContext?: string | null;
  targetUrl?: string | null;
  stepCount: number;
  currentStep?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  completedAt?: string | null;
}

// ── Product Skills ─────────────────────────────────────────────────────────

export type SkillType =
  | 'UI_FLOW'
  | 'BUSINESS_USE_CASE'
  | 'TEST_DATA'
  | 'HLD'
  | 'API_CONTRACT'
  | 'USER_ROLE'
  | 'UX_DESIGN'
  | 'HISTORICAL'
  | 'FUNCTIONAL_RULES'
  | 'LOCATOR_GUIDE'
  | 'TEST_CASE_DOC';

export type SkillTier = 'GLOBAL' | 'FEATURE' | 'HISTORICAL';

export type SkillCaptureMethod =
  | 'AGENT_RECORDED'
  | 'USER_UPLOADED'
  | 'MANUALLY_ENTERED'
  | 'LLM_EXTRACTED'
  | 'AUTO_ACCUMULATED'
  | 'USER_RECORDED'
  | 'MANUAL_QA_FEEDBACK';

export interface ProjectSkill {
  id: string;
  projectId: string;
  skillType: SkillType;
  name: string;
  scope?: string | null;
  featureGroup?: string | null;
  tier?: SkillTier | null;       // injection scope: GLOBAL | FEATURE | HISTORICAL
  humanContext?: string | null;  // QA engineer correction text (HISTORICAL skills)
  content: string; // JSON string — parse before use
  captureMethod: SkillCaptureMethod;
  confidence: number;
  isActive: boolean;
  capturedAt: string;
  updatedAt: string;
}

export interface UIFlowSkillContent {
  targetUrl: string;
  navigationPath: string[];
  locators: Array<{
    semanticName: string;
    selector: string;
    locatorType: string;
    interactionNote?: string;
  }>;
  stateTransitions: Array<{
    trigger: string;
    resultState: string;
    waitCondition?: string;
  }>;
  validations: Array<{
    field: string;
    rule: string;
    errorText: string;
  }>;
  prerequisiteState?: string;
  loginRequired: boolean;
  notes?: string;
}

export interface BusinessUseCaseSkillContent {
  useCaseName: string;
  actors: string[];
  preconditions: string[];
  businessRules: string[];
  successCriteria: string[];
  edgeCases: string[];
  relatedScreens: string[];
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  notes?: string;
}

export interface TestDataSkillContent {
  scope: string;
  validData: Record<string, unknown>;
  invalidData: Record<string, unknown>;
  boundaryValues: Record<string, unknown>;
  referenceData: Record<string, unknown>;
  dataSetupInstructions?: string;
}

export interface HLDSkillContent {
  moduleName: string;
  description: string;
  components: string[];
  integrations: Array<{
    from: string;
    to: string;
    trigger: string;
    async: boolean;
    delay?: string;
  }>;
  apis: string[];
  notes?: string;
}

export interface APIContractSkillContent {
  endpoint: string;
  method: string;
  purpose: string;
  requestSchema: Record<string, unknown>;
  responses: Record<string, unknown>;
  authRequired: boolean;
  notes?: string;
}

export interface UserRoleSkillContent {
  roleName: string;
  testCredentials?: { username: string; password: string };
  permissions: string[];
  restrictions: string[];
  visibleMenuItems: string[];
  hiddenMenuItems: string[];
  notes?: string;
}

export interface UXDesignSkillContent {
  screen: string;
  components: Array<{
    name: string;
    componentType: string;
    interaction?: string;
    required?: boolean;
  }>;
  exactCopy: Record<string, string>;
  requiredFields: string[];
  notes?: string;
}
