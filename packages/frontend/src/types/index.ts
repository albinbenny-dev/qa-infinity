export interface User {
  id: string;
  email: string;
  name: string;
  globalRole: 'SUPER_ADMIN' | 'USER';
}

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
  _count?: {
    testCases: number;
    members: number;
  };
  members?: ProjectMember[];
  envConfigs?: EnvConfig[];
  requirementDocs?: RequirementDoc[];
}

export interface ProjectMember {
  projectId: string;
  userId: string;
  role: 'ADMIN' | 'QA_ENGINEER' | 'VIEWER';
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
  lastRun?: RunResult;
}

export interface Run {
  id: string;
  projectId: string;
  name: string;
  environment: string;
  status: 'PENDING' | 'RUNNING' | 'PASSED' | 'FAILED' | 'CANCELLED';
  startedAt?: string;
  completedAt?: string;
  triggerType: 'MANUAL' | 'SCHEDULED' | 'INDIVIDUAL' | 'GROUP';
  results?: RunResult[];
}

export interface RunResult {
  id: string;
  runId: string;
  testCaseId: string;
  status: 'pass' | 'fail' | 'skip';
  duration?: number;
  errorMessage?: string;
  screenshotPath?: string;
  tracePath?: string;
}

export interface Script {
  id: string;
  projectId: string;
  testCaseId?: string | null;
  filename: string;
  isCustomUpload: boolean;
  createdAt: string;
  updatedAt: string;
  testCase?: Pick<TestCase, 'id' | 'tcId' | 'title'> & { useCaseTag?: string | null };
  lastRunStatus?: 'PASSED' | 'FAILED' | 'RUNNING' | 'PENDING' | 'CANCELLED' | null;
  size?: number | null;
  modifiedAt?: string | null;
}

export interface HealProposal {
  id: string;
  projectId: string;
  runResultId: string;
  type: 'SELECTOR' | 'FLOW' | 'API_SCHEMA';
  originalCode: string;
  patchedCode: string;
  confidence: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'AUTO_APPLIED';
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
