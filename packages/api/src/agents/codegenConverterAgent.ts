import { callAgent } from '../lib/skillsContext.js';

const SYSTEM_PROMPT = `You are a Robot Framework script converter.
Convert Playwright TypeScript codegen output into a Robot Framework .robot file using the Browser library (playwright backend).

OUTPUT RULES — FOLLOW EXACTLY:
- Output ONLY the .robot file content. No explanations, no markdown fences, no commentary.
- Start directly with *** Settings ***

CONVERSION MAPPINGS (apply mechanically):
Playwright TS                               → Robot Framework (Browser library)
────────────────────────────────────────────────────────────────────────────────
await page.goto('URL')                      → New Page    URL
await page.locator('SEL').fill('VAL')       → Fill Text    css=SEL    VAL
await page.locator('SEL').click()           → Click    css=SEL
await page.locator('SEL').press('Key')      → Keyboard Key    css=SEL    Key
await page.locator('SEL').selectOption(V)   → Select Options By    css=SEL    value    V
await page.locator('SEL').check()           → Check Checkbox    css=SEL
await page.locator('SEL').uncheck()         → Uncheck Checkbox    css=SEL
await expect(page.locator('SEL')).toBeVisible() → Wait For Elements State    css=SEL    visible    timeout=30s
await expect(page.locator('SEL')).toHaveText(T) → Get Text    ${'{'}text{'}'}    css=SEL\n    Should Be Equal    ${'{'}text{'}'}    T
await page.waitForSelector('SEL')           → Wait For Elements State    css=SEL    visible    timeout=30s
await page.keyboard.press('Key')            → Keyboard Key    KEYBOARD    Key

LOCATOR RULES:
- All css selectors must be prefixed with css=
- xpath selectors: xpath=//...
- text selectors: text=...
- Never output bare selectors without a strategy prefix

TEMPLATE STRUCTURE:
*** Settings ***
Library           Browser

*** Variables ***
\${BASE_URL}        \${EMPTY}
\${TC_USERNAME}     \${EMPTY}
\${TC_PASSWORD}     \${EMPTY}

*** Test Cases ***
<Test Name From Recording>
    [Documentation]    Recorded via Playwright codegen
    [Setup]    Open Test Session
    [Teardown]    Close Test Session
    <converted steps — call keywords>

*** Keywords ***
Open Test Session
    New Browser    chromium    headless=True
    New Context    ignoreHTTPSErrors=True    viewport={'width': 1280, 'height': 720}
    New Page    \${BASE_URL}

Close Test Session
    Take Screenshot
    Close Browser

<more keywords — one per logical group of steps>

KEYWORD RULES:
- Extract repeated patterns into keywords
- Each keyword does ONE thing
- Never duplicate keyword names
- Variables use \${VAR_NAME} syntax
`;

export async function convertCodegenToRobot(input: {
  playwrightCode: string;
  projectId: string;
  projectName: string;
  testCaseName?: string;
}): Promise<string> {
  const userPrompt = `Convert this Playwright codegen output to Robot Framework.
Test case name: ${input.testCaseName ?? 'Recorded Test'}

\`\`\`typescript
${input.playwrightCode}
\`\`\`

Output only the .robot file, starting with *** Settings ***.`;

  let content = await callAgent({
    systemPrompt: SYSTEM_PROMPT,
    userContent: userPrompt,
    agentName: 'script-agent',
    projectId: input.projectId,
    projectName: input.projectName,
    maxTokens: 8192,
  });

  // Strip markdown fences if model wrapped output
  content = content.replace(/^```[\w]*\n?/gm, '').replace(/^```$/gm, '').trim();

  // Strip <think> blocks from reasoning models
  content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // Ensure starts with *** Settings ***
  const settingsIdx = content.search(/\*{3}\s*Settings\s*\*{3}/i);
  if (settingsIdx > 0) content = content.slice(settingsIdx);

  return content;
}
