import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { createLLM } from '../lib/llm.js';
import type { ScanResult } from '../services/uiScannerService.js';
import type {
  NavNode,
  PageLocators,
  LoginInstructions,
} from '../types/scanner.js';

export interface UseCaseSuggestion {
  useCase: string;
  color: string;
  pages: string[];
  testCaseTitles: string[];
}

export interface UIContextResult {
  loginInstructions: LoginInstructions;
  navigationMap: NavNode[];
  pageLocators: Record<string, PageLocators>;
  useCaseSuggestions: UseCaseSuggestion[];
}

const SYSTEM_PROMPT = `You are a senior QA analyst. You receive a structured dump of every page in a web application:
URL, nav label, accessibility snapshot, and extracted locators.
You may also receive requirement documents (BRD, HLD, test cases, specs) in the PROJECT REQUIREMENT LIBRARY section.

Your job is to produce:
1. A clean navigation map (group pages into modules by their nav path)
2. A locator library (semantic name → best stable selector per page)
3. High-level use cases (group pages by functional area, suggest 4-8 test case titles per group)
4. Annotate the login instructions with any discovered notes (two-step form, SSO, etc.)

For use cases, use business-meaningful names (e.g. "Primary Sales", "Stock Management") not
technical route names. Each use case should map to 3-8 pages.

When generating testCaseTitles for each use case:
- Cross-reference the PROJECT REQUIREMENT LIBRARY (BRD, HLD, test case docs) if provided.
- Derive titles from documented business rules, acceptance criteria, and functional requirements.
- Ensure titles cover happy paths, negative scenarios, and boundary/edge cases described in those docs.
- If the library already contains test case titles for a feature, use them as a base and expand coverage.

If custom instructions are provided, take them into account when grouping pages into use cases
and when describing the navigation flow.

Return ONLY a valid JSON object with this shape (no markdown fences):
{
  "loginInstructions": { <same shape as input, with notes enriched> },
  "navigationMap": [ <NavNode[]> ],
  "pageLocators": { "<urlPattern>": { "urlPattern": "...", "navLabel": "...", "locators": [...] } },
  "useCaseSuggestions": [
    {
      "useCase": "Business-meaningful name",
      "color": "#hexcolor",
      "pages": ["Nav Label 1", "Nav Label 2"],
      "testCaseTitles": ["TC title 1", "TC title 2", "TC title 3", "TC title 4"]
    }
  ]
}`;

const USE_CASE_COLORS = [
  '#2563AB', '#F47B20', '#2A9D8F', '#7C3AED', '#DC2626',
  '#059669', '#D97706', '#DB2777', '#0891B2', '#65A30D',
];

export async function runUIContextAgent(
  scanResult: ScanResult,
  customInstructions?: string,
  reqLibraryContext?: string,
): Promise<UIContextResult> {
  const llm = createLLM({ temperature: 0.2, agentName: 'ui-context-agent' });

  const { pages, loginInstructions, navigationMap } = scanResult;

  // Build page summaries for the prompt (cap per-page content to stay within token budget)
  const pageSummaries = pages.map((p, i) => {
    const locatorLines = p.keyLocators
      .slice(0, 5)
      .map((l) => `    - ${l.semanticName}: ${l.selector}`)
      .join('\n');

    return [
      `### Page ${i + 1}: ${p.navLabel}`,
      `URL: ${p.url}`,
      `Forms: ${p.formCount}  Inputs: ${p.inputCount}  Buttons: ${p.buttonCount}`,
      'Key locators:',
      locatorLines || '    (none detected)',
      'Accessibility snapshot (truncated):',
      `    ${p.accessibilityTree.slice(0, 1500)}`,
    ].join('\n');
  });

  const navSummary = flattenForPrompt(navigationMap).join('\n');

  const textContent = [
    `Application has ${pages.length} pages scanned.`,
    '',
    ...(customInstructions ? [
      '## Custom project instructions (provided by the QA team):',
      customInstructions,
      '',
    ] : []),
    ...(reqLibraryContext ? [
      '## PROJECT REQUIREMENT LIBRARY (BRD / HLD / Test Cases / Specs):',
      reqLibraryContext.slice(0, 10000),
      '',
    ] : []),
    '## Navigation structure:',
    navSummary || '(no navigation detected)',
    '',
    '## Login instructions detected:',
    JSON.stringify(loginInstructions, null, 2),
    '',
    '## Page details:',
    pageSummaries.join('\n\n'),
  ].join('\n');

  const response = await llm.invoke([new SystemMessage(SYSTEM_PROMPT), new HumanMessage(textContent)]);

  const raw =
    typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

  const result = parseContextResult(raw, loginInstructions, navigationMap, pages);
  return result;
}

function flattenForPrompt(nodes: NavNode[], indent = 0): string[] {
  const lines: string[] = [];
  for (const node of nodes) {
    lines.push(`${'  '.repeat(indent)}- ${node.label} → ${node.url}`);
    if (node.children.length > 0) {
      lines.push(...flattenForPrompt(node.children, indent + 1));
    }
  }
  return lines;
}

function parseContextResult(
  raw: string,
  loginInstructions: LoginInstructions,
  navigationMap: NavNode[],
  pages: import('../types/scanner.js').PageScanData[],
): UIContextResult {
  // Strip markdown fences if present
  const cleaned = raw.replace(/^```(?:json)?\s*/im, '').replace(/```\s*$/im, '').trim();

  try {
    const parsed = JSON.parse(cleaned) as Partial<UIContextResult & { useCaseSuggestions: UseCaseSuggestion[] }>;

    // Assign colors to use case suggestions if missing
    const suggestions: UseCaseSuggestion[] = (parsed.useCaseSuggestions ?? []).map((s, i) => ({
      useCase: s.useCase ?? `Use Case ${i + 1}`,
      color: s.color ?? USE_CASE_COLORS[i % USE_CASE_COLORS.length],
      pages: s.pages ?? [],
      testCaseTitles: s.testCaseTitles ?? [],
    }));

    return {
      loginInstructions: (parsed.loginInstructions as LoginInstructions) ?? loginInstructions,
      navigationMap: (parsed.navigationMap as NavNode[]) ?? navigationMap,
      pageLocators: (parsed.pageLocators as Record<string, PageLocators>) ?? buildFallbackLocators(pages),
      useCaseSuggestions: suggestions,
    };
  } catch {
    // Fallback: return unprocessed scan data
    return {
      loginInstructions,
      navigationMap,
      pageLocators: buildFallbackLocators(pages),
      useCaseSuggestions: [],
    };
  }
}

function buildFallbackLocators(
  pages: import('../types/scanner.js').PageScanData[],
): Record<string, PageLocators> {
  const result: Record<string, PageLocators> = {};
  for (const p of pages) {
    const pattern = p.url.replace(/[0-9a-f]{8,}/gi, ':id').replace(/\d+/g, ':num');
    result[pattern] = {
      urlPattern: pattern,
      navLabel: p.navLabel,
      locators: p.keyLocators,
    };
  }
  return result;
}
