export interface PageScanData {
  url: string;
  navLabel: string;
  navPath: string[];
  screenshotBase64: string | null;
  accessibilityTree: string;
  keyLocators: KeyLocator[];
  formCount: number;
  inputCount: number;
  buttonCount: number;
  loadTimeMs: number;
}

export interface KeyLocator {
  semanticName: string;
  selector: string;
  locatorType: 'css' | 'aria' | 'testid' | 'role';
}

export interface LoginInstructions {
  steps: LoginStep[];
  selectors: {
    username: string;
    password: string;
    submit: string;
  };
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
  pageType: 'form' | 'list' | 'dashboard' | 'settings' | 'other';
  depth: number;
}

export interface PageLocators {
  urlPattern: string;
  navLabel: string;
  locators: KeyLocator[];
}

export interface UseCaseSummary {
  name: string;
  color: string;
  pages: string[];
  tcCount: number;
}

export interface ScanJobPayload {
  scanId: string;
  projectId: string;
  baseUrl: string;
  username: string;
  password: string;
  scanDepth: 'full' | 'top-level' | 'login-only';
  generateTCs: boolean;
  triggeredBy: string;
}
