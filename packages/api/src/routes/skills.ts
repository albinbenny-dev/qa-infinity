import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/projectAccess.js';
import { readUploadedFile, mimeFromPath } from '../services/inputAdapters.js';
import { createLLM, createAnthropicDirectClient } from '../lib/llm.js';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { saveSkillFile, deleteSkillFile, type SkillFileData } from '../services/scriptFileService.js';
import { runWriterAgent } from '../agents/writerAgent.js';
import { getLibraryContext } from '../services/reqLibraryLoader.js';
import { detectAndParseApiSpec } from '../services/apiSpecParser.js';
import { z } from 'zod';

const router = Router({ mergeParams: true });
router.use(verifyToken as RequestHandler);
router.use(requireProjectAccess as unknown as RequestHandler);

// ── Constants ──────────────────────────────────────────────────────────────

const SKILL_TYPES = [
  'UI_FLOW',
  'BUSINESS_USE_CASE',
  'TEST_DATA',
  'HLD',
  'API_CONTRACT',
  'USER_ROLE',
  'UX_DESIGN',
  'HISTORICAL',
  'FUNCTIONAL_RULES',
  'LOCATOR_GUIDE',
  'TEST_CASE_DOC',
] as const;

type SkillType = typeof SKILL_TYPES[number];

// ── Zod schemas ────────────────────────────────────────────────────────────

const CreateSkillSchema = z.object({
  skillType: z.enum(SKILL_TYPES),
  name: z.string().min(1).max(200),
  scope: z.string().optional(),
  featureGroup: z.string().max(120).optional().nullable(),
  tier: z.enum(['GLOBAL', 'FEATURE', 'HISTORICAL']).optional().default('FEATURE'),
  content: z.string().min(2),
  humanContext: z.string().max(4000).optional().nullable(),
  captureMethod: z
    .enum(['AGENT_RECORDED', 'USER_UPLOADED', 'MANUALLY_ENTERED', 'LLM_EXTRACTED', 'AUTO_ACCUMULATED', 'MANUALLY_UPLOADED', 'MANUAL_QA_FEEDBACK'])
    .optional()
    .default('MANUALLY_ENTERED'),
  confidence: z.number().min(0).max(1).optional().default(0.8),
});

const UpdateSkillSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  scope: z.string().optional(),
  featureGroup: z.string().max(120).optional().nullable(),
  tier: z.enum(['GLOBAL', 'FEATURE', 'HISTORICAL']).optional(),
  content: z.string().min(2).optional(),
  humanContext: z.string().max(4000).optional().nullable(),
  isActive: z.boolean().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const StartRecordingSchema = z.object({
  name: z.string().min(1).max(200),
  targetUrl: z.string().min(1),
  scope: z.string().optional(),
});

const StopRecordingSchema = z.object({
  sessionId: z.string().min(1),
  name: z.string().min(1).max(200),
  targetUrl: z.string().min(1),
  scope: z.string().optional(),
  featureGroup: z.string().max(120).optional().nullable(),
});

const ExtractFromDocSchema = z.object({
  skillType: z.enum(['BUSINESS_USE_CASE', 'HLD', 'API_CONTRACT', 'UX_DESIGN', 'FUNCTIONAL_RULES', 'TEST_DATA', 'USER_ROLE', 'UI_FLOW', 'LOCATOR_GUIDE', 'TEST_CASE_DOC']),
  name: z.string().min(1).max(200),
  filePath: z.string().min(1),
  scope: z.string().optional(),
  featureGroup: z.string().optional(),
});

const UploadSkillFileSchema = z.object({
  skillType: z.enum(SKILL_TYPES),
  name: z.string().min(1).max(200),
  scope: z.string().optional(),
  confidence: z.number().min(0).max(1).optional().default(0.9),
  content: z.union([z.string().min(2), z.record(z.unknown())]),
});

// ── Helpers ────────────────────────────────────────────────────────────────

function toSkillFileData(skill: {
  id: string; skillType: string; name: string; scope: string | null;
  featureGroup?: string | null; tier?: string | null; humanContext?: string | null;
  content: string; confidence: number; captureMethod: string; isActive: boolean; updatedAt: Date;
}): SkillFileData {
  return {
    id: skill.id, skillType: skill.skillType, name: skill.name,
    scope: skill.scope, featureGroup: skill.featureGroup,
    tier: skill.tier, humanContext: skill.humanContext,
    content: skill.content, confidence: skill.confidence,
    captureMethod: skill.captureMethod, isActive: skill.isActive,
    updatedAt: skill.updatedAt.toISOString(),
  };
}

// ── GET / — list all skills for the project ────────────────────────────────

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { skillType, isActive } = req.query;
    const where: Record<string, unknown> = { projectId: req.project.id };
    if (skillType && SKILL_TYPES.includes(skillType as SkillType)) {
      where.skillType = skillType;
    }
    if (isActive !== undefined) {
      where.isActive = isActive === 'true';
    }
    const skills = await prisma.projectSkill.findMany({
      where,
      orderBy: [{ skillType: 'asc' }, { updatedAt: 'desc' }],
    });
    res.json({ skills, total: skills.length });
  } catch (err) {
    next(err);
  }
});

// ── GET /relevant — keyword-score relevant skills for a query ──────────────

router.get('/relevant', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = String(req.query.q ?? '').toLowerCase().trim();
    if (!q) {
      res.json({ skills: [] });
      return;
    }

    const allActive = await prisma.projectSkill.findMany({
      where: { projectId: req.project.id, isActive: true },
      orderBy: { updatedAt: 'desc' },
    });

    const words = q.split(/\s+/).filter((w) => w.length > 2);

    type ScoredSkill = { skill: typeof allActive[number]; score: number };
    const scored: ScoredSkill[] = allActive.map((skill) => {
      let score = 0;
      const haystack = [skill.name, skill.scope ?? '', skill.content.slice(0, 500)]
        .join(' ')
        .toLowerCase();
      for (const word of words) {
        if (haystack.includes(word)) score += 1;
      }
      // Always include UI flows and test data
      if (skill.skillType === 'UI_FLOW') score += 0.5;
      if (skill.skillType === 'TEST_DATA') score += 0.3;
      return { skill, score };
    });

    const relevant = scored
      .filter((s: ScoredSkill) => s.score > 0)
      .sort((a: ScoredSkill, b: ScoredSkill) => b.score - a.score)
      .slice(0, 8)
      .map((s: ScoredSkill) => s.skill);

    res.json({ skills: relevant });
  } catch (err) {
    next(err);
  }
});

// ── POST / — create a skill manually ──────────────────────────────────────

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = CreateSkillSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
      return;
    }
    const { skillType, name, scope, featureGroup, tier, content, humanContext, captureMethod, confidence } = parsed.data;
    const skill = await prisma.projectSkill.create({
      data: {
        projectId: req.project.id,
        skillType,
        name,
        scope: scope ?? null,
        featureGroup: featureGroup ?? null,
        tier: tier ?? 'FEATURE',
        content,
        humanContext: humanContext ?? null,
        captureMethod: captureMethod ?? 'MANUALLY_ENTERED',
        confidence: confidence ?? 0.8,
      },
    });
    if (skill.isActive) {
      saveSkillFile(req.project.slug, skill.id, toSkillFileData(skill));
    }
    res.status(201).json({ skill });
  } catch (err) {
    next(err);
  }
});

// ── POST /parse-api-spec — detect + parse curl / OpenAPI / Postman input ──

const ParseApiSpecSchema = z.object({
  text: z.string().min(1).max(2_000_000),
});

router.post('/parse-api-spec', (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = ParseApiSpecSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
      return;
    }
    const result = detectAndParseApiSpec(parsed.data.text);
    if (result.format === 'unknown' || result.endpoints.length === 0) {
      res.status(400).json({
        error: 'Could not recognize this as a curl command, OpenAPI/Swagger spec, or Postman collection.',
      });
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── POST /import-api-contracts — bulk-create API_CONTRACT skills ──────────

const ImportApiContractsSchema = z.object({
  scope: z.string().optional(),
  featureGroup: z.string().max(120).optional().nullable(),
  endpoints: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        method: z.string().min(1),
        endpoint: z.string().min(1),
        purpose: z.string().optional().default(''),
        requestSchema: z.unknown().optional(),
        responses: z.unknown().optional(),
        authRequired: z.boolean().optional().default(false),
        notes: z.string().optional().default(''),
      }),
    )
    .min(1)
    .max(200),
});

router.post('/import-api-contracts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = ImportApiContractsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
      return;
    }
    const { scope, featureGroup, endpoints } = parsed.data;

    const created = [];
    for (const ep of endpoints) {
      const content = JSON.stringify({
        endpoint: ep.endpoint,
        method: ep.method.toUpperCase(),
        purpose: ep.purpose,
        requestSchema: ep.requestSchema ?? {},
        responses: ep.responses ?? { '200': {} },
        authRequired: ep.authRequired,
        notes: ep.notes,
      });
      const skill = await prisma.projectSkill.create({
        data: {
          projectId: req.project.id,
          skillType: 'API_CONTRACT',
          name: ep.name,
          scope: scope ?? null,
          featureGroup: featureGroup ?? null,
          content,
          captureMethod: 'USER_UPLOADED',
          confidence: 0.9,
        },
      });
      if (skill.isActive) {
        saveSkillFile(req.project.slug, skill.id, toSkillFileData(skill));
      }
      created.push(skill);
    }

    res.status(201).json({ skills: created, count: created.length });
  } catch (err) {
    next(err);
  }
});

// ── PUT /:skillId — update a skill ────────────────────────────────────────

router.put('/:skillId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = UpdateSkillSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
      return;
    }
    const skill = await prisma.projectSkill.findFirst({
      where: { id: req.params.skillId, projectId: req.project.id },
    });
    if (!skill) {
      res.status(404).json({ error: 'Skill not found' });
      return;
    }
    const updated = await prisma.projectSkill.update({
      where: { id: req.params.skillId },
      data: parsed.data,
    });
    if (updated.isActive) {
      saveSkillFile(req.project.slug, updated.id, toSkillFileData(updated));
    } else {
      deleteSkillFile(req.project.slug, updated.id);
    }
    res.json({ skill: updated });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /:skillId ──────────────────────────────────────────────────────

router.delete('/:skillId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const skill = await prisma.projectSkill.findFirst({
      where: { id: req.params.skillId, projectId: req.project.id },
    });
    if (!skill) {
      res.status(404).json({ error: 'Skill not found' });
      return;
    }
    await prisma.projectSkill.delete({ where: { id: req.params.skillId } });
    deleteSkillFile(req.project.slug, req.params.skillId);
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

// ── Playwright codegen output → UI_FLOW skill content ─────────────────────

function parsePlaywrightCodegen(
  code: string,
  targetUrl: string,
): Record<string, unknown> {
  const locators: Array<{
    semanticName: string;
    selector: string;
    locatorType: string;
    interactionNote?: string;
  }> = [];
  const stateTransitions: Array<{ trigger: string; resultState: string }> = [];
  const navigationPath: string[] = [];
  let capturedUrl = targetUrl;

  const gotoMatch = code.match(/page\.goto\(['"`](.*?)['"`]/);
  if (gotoMatch) capturedUrl = gotoMatch[1];

  for (const line of code.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('await page.') && !t.startsWith('await expect(')) continue;

    let selector = '';
    let locatorType = 'css';
    let semanticName = '';

    const roleM = t.match(/getByRole\(['"`](\w+)['"`],\s*\{\s*name:\s*['"`](.*?)['"`]/);
    if (roleM) { locatorType = 'role'; selector = roleM[2]; semanticName = `${roleM[1]} "${roleM[2]}"`; }

    const labelM = !roleM && t.match(/getByLabel\(['"`](.*?)['"`]\)/);
    if (labelM) { locatorType = 'label'; selector = labelM[1]; semanticName = labelM[1]; }

    const phM = !roleM && !labelM && t.match(/getByPlaceholder\(['"`](.*?)['"`]\)/);
    if (phM) { locatorType = 'placeholder'; selector = phM[1]; semanticName = phM[1]; }

    const textM = !roleM && !labelM && !phM && t.match(/getByText\(['"`](.*?)['"`]\)/);
    if (textM) { locatorType = 'text'; selector = textM[1]; semanticName = textM[1]; }

    const tidM = !roleM && !labelM && !phM && !textM && t.match(/getByTestId\(['"`](.*?)['"`]\)/);
    if (tidM) { locatorType = 'css'; selector = `[data-testid="${tidM[1]}"]`; semanticName = tidM[1]; }

    const cssM = !roleM && !labelM && !phM && !textM && !tidM && t.match(/\.locator\(['"`](.*?)['"`]\)/);
    if (cssM) { locatorType = 'css'; selector = cssM[1]; semanticName = cssM[1]; }

    const action = t.includes('.fill(') ? 'fill'
      : t.includes('.selectOption(') ? 'selectOption'
      : t.includes('.check(') ? 'check'
      : t.includes('.press(') ? 'press'
      : t.includes('.click(') ? 'click'
      : t.includes('.waitFor(') ? 'waitFor'
      : '';

    if (selector && action) {
      locators.push({
        semanticName: semanticName || selector,
        selector,
        locatorType,
        interactionNote: action !== 'click' ? action : undefined,
      });
      if (action === 'click') {
        stateTransitions.push({
          trigger: `Click ${semanticName || selector}`,
          resultState: 'page state changed',
        });
      }
    }

    const navM = t.match(/page\.goto\(['"`](.*?)['"`]/);
    if (navM) navigationPath.push(navM[1]);
  }

  return {
    targetUrl: capturedUrl,
    navigationPath,
    locators: locators.slice(0, 60),
    stateTransitions: stateTransitions.slice(0, 30),
    validations: [],
    loginRequired: false,
    rawPlaywrightCode: code.slice(0, 4000),
    notes: `Human-recorded via Playwright Codegen — ${new Date().toISOString()}`,
  };
}

// ── POST /start-recording — start Playwright Codegen on the runner ─────────

router.post('/start-recording', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = StartRecordingSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
      return;
    }
    const { name, targetUrl, scope } = parsed.data;
    const runnerUrl = process.env.RUNNER_URL ?? 'http://qa-runner:5001';
    const sessionId = `rec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const runnerRes = await fetch(`${runnerUrl}/record/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: targetUrl, sessionId }),
    });

    if (!runnerRes.ok) {
      const errText = await runnerRes.text();
      res.status(502).json({ error: `Runner failed to start recording: ${errText}` });
      return;
    }

    await runnerRes.json();
    res.json({ sessionId, name, targetUrl, scope: scope ?? null, novncPort: 6180 });
  } catch (err) {
    next(err);
  }
});

// ── POST /stop-recording — stop Codegen, parse output, save skill ──────────

router.post('/stop-recording', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = StopRecordingSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
      return;
    }
    const { sessionId, name, targetUrl, scope, featureGroup } = parsed.data;
    const runnerUrl = process.env.RUNNER_URL ?? 'http://qa-runner:5001';

    const runnerRes = await fetch(`${runnerUrl}/record/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });

    if (!runnerRes.ok) {
      const errText = await runnerRes.text();
      res.status(502).json({ error: `Runner failed to stop recording: ${errText}` });
      return;
    }

    const { playwrightCode } = (await runnerRes.json()) as { playwrightCode: string };
    const skillContent = parsePlaywrightCodegen(playwrightCode ?? '', targetUrl);

    const skill = await prisma.projectSkill.create({
      data: {
        projectId: req.project.id,
        skillType: 'UI_FLOW',
        name,
        scope: scope ?? null,
        featureGroup: featureGroup ?? null,
        content: JSON.stringify(skillContent),
        captureMethod: 'USER_RECORDED',
        confidence: 0.95,
      },
    });
    if (skill.isActive) {
      saveSkillFile(req.project.slug, skill.id, toSkillFileData(skill));
    }

    res.status(201).json({ skill });
  } catch (err) {
    next(err);
  }
});

// ── POST /cancel-recording — kill codegen without saving ──────────────────

router.post('/cancel-recording', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { sessionId } = req.body as { sessionId?: string };
    if (!sessionId) {
      res.status(400).json({ error: 'sessionId is required' });
      return;
    }
    const runnerUrl = process.env.RUNNER_URL ?? 'http://qa-runner:5001';
    const runnerRes = await fetch(`${runnerUrl}/record/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    const data = await runnerRes.json();
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// ── POST /extract-from-doc — LLM extracts structured skill from uploaded doc

router.post('/extract-from-doc', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = ExtractFromDocSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
      return;
    }
    const { skillType, name, filePath, scope, featureGroup } = parsed.data;

    const docContent = await readUploadedFile(filePath, mimeFromPath(filePath));

    const extractPrompts: Record<string, string> = {
      BUSINESS_USE_CASE: `Extract business use case information. Return ONLY a JSON object:
{"useCaseName":"...","actors":[],"preconditions":[],"businessRules":[],"successCriteria":[],"edgeCases":[],"relatedScreens":[],"priority":"MEDIUM","notes":""}`,
      HLD: `Extract high-level design information. Return ONLY a JSON object:
{"moduleName":"...","description":"...","components":[],"integrations":[{"from":"","to":"","trigger":"","async":false}],"apis":[],"notes":""}`,
      API_CONTRACT: `Extract API contract details. Return ONLY a JSON object:
{"endpoint":"...","method":"GET","purpose":"...","requestSchema":{},"responses":{"200":{}},"authRequired":true,"notes":""}`,
      UX_DESIGN: `Extract UI/UX design information. Return ONLY a JSON object:
{"screen":"...","components":[{"name":"","componentType":"","interaction":"","required":false}],"exactCopy":{},"requiredFields":[],"notes":""}`,
      FUNCTIONAL_RULES: `Extract functional rules and business logic. Return ONLY a JSON object:
{"summary":"what this feature does in 1-2 sentences","fieldConstraints":["field: rule"],"dataRelationships":["relationship description"],"knownFailureModes":["scenario → expected error/behavior"],"permissionScenarios":["role: what they can/cannot do"],"functionalVariations":["scenario to test"],"notes":""}`,
      TEST_DATA: `Extract test data sets and credentials. Return ONLY a JSON object:
{"accounts":[{"username":"","password":"","role":"","status":"active"}],"products":[{"code":"","name":"","type":"physical"}],"referenceData":["key: value"],"notes":""}`,
      USER_ROLE: `Extract user role and permission information. Return ONLY a JSON object:
{"roleName":"...","permissions":["can do X"],"restrictions":["cannot do Y"],"typicalWorkflow":["step 1","step 2"],"notes":""}`,
      UI_FLOW: `Extract UI navigation flow steps. Return ONLY a JSON object:
{"flowName":"...","startingPoint":"...","steps":[{"action":"click/fill/navigate","target":"element or page","value":"","notes":""}],"runtimeCaptures":[],"expectedOutcome":"","notes":""}`,
      LOCATOR_GUIDE: `Extract element locator patterns and naming conventions. Return ONLY a JSON object:
{"summary":"describe the locator conventions","locators":[{"pattern":"id pattern with {variable}","example":"concrete-id-123","notes":"when this pattern is used"}],"notes":""}`,
      TEST_CASE_DOC: `Extract test case scenarios and steps. Return ONLY a JSON object:
{"summary":"what feature is being tested","scenarios":[{"name":"scenario name","steps":["step 1","step 2"],"expectedResult":"","type":"happy path"}],"notes":""}`,
    };

    let extractedContent: string;

    const directClient = createAnthropicDirectClient();
    if (directClient) {
      // Use Anthropic SDK directly — cleaner JSON extraction
      const response = await directClient.messages.create({
        model: process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8',
        max_tokens: 2048,
        system: 'You are a QA analyst. Extract structured information from the document. Return ONLY a valid JSON object — no markdown fences, no explanation, no other text.',
        messages: [{
          role: 'user',
          content: `Document:\n\n${docContent.slice(0, 8000)}\n\n${extractPrompts[skillType]}`,
        }],
      });
      const textBlock = response.content.find((b): b is { type: 'text'; text: string } => b.type === 'text');
      const raw = (textBlock?.text ?? '').trim().replace(/^```json\n?|^```\n?|```$/gm, '').trim();
      try {
        JSON.parse(raw);
        extractedContent = raw;
      } catch {
        extractedContent = JSON.stringify({ raw: raw.slice(0, 2000), error: 'Could not parse structured output — edit content manually' });
      }
    } else {
      const llm = createLLM({ temperature: 0, agentName: 'writer-agent' });
      const response = await llm.invoke([
        new SystemMessage(
          'You are a QA analyst. Extract structured information from the document. Return ONLY valid JSON — no markdown fences, no explanation.',
        ),
        new HumanMessage(
          `Document:\n\n${docContent.slice(0, 8000)}\n\n${extractPrompts[skillType]}`,
        ),
      ]);
      const raw = String(response.content).trim().replace(/^```json\n?|^```\n?|```$/gm, '').trim();
      // Try to extract JSON object from the response even if surrounded by explanation text
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      try {
        const candidate = jsonMatch ? jsonMatch[0] : raw;
        JSON.parse(candidate);
        extractedContent = candidate;
      } catch {
        extractedContent = JSON.stringify({ raw: raw.slice(0, 2000), error: 'Could not parse structured output — edit content manually' });
      }
    }

    const skill = await prisma.projectSkill.create({
      data: {
        projectId: req.project.id,
        skillType,
        name,
        scope: scope ?? null,
        featureGroup: featureGroup ?? null,
        content: extractedContent,
        captureMethod: 'LLM_EXTRACTED',
        confidence: 0.7,
      },
    });
    if (skill.isActive) {
      saveSkillFile(req.project.slug, skill.id, toSkillFileData(skill));
    }

    res.status(201).json({ skill });
  } catch (err) {
    next(err);
  }
});

// ── POST /convert-from-text — LLM converts plain-text description to structured skill JSON

const ConvertFromTextSchema = z.object({
  skillType: z.enum(['BUSINESS_USE_CASE', 'HLD', 'API_CONTRACT', 'UX_DESIGN', 'FUNCTIONAL_RULES', 'TEST_DATA', 'USER_ROLE', 'UI_FLOW', 'LOCATOR_GUIDE', 'TEST_CASE_DOC']),
  name: z.string().min(1).max(200),
  text: z.string().min(10).max(20000),
  scope: z.string().optional(),
  featureGroup: z.string().optional(),
});

router.post('/convert-from-text', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = ConvertFromTextSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
      return;
    }
    const { skillType, name, text, scope, featureGroup } = parsed.data;

    const extractPrompts: Record<string, string> = {
      BUSINESS_USE_CASE: `Convert the description into a structured business use case. Return ONLY a JSON object:
{"useCaseName":"...","actors":[],"preconditions":[],"businessRules":[],"successCriteria":[],"edgeCases":[],"relatedScreens":[],"priority":"MEDIUM","notes":""}`,
      HLD: `Convert the description into a structured high-level design. Return ONLY a JSON object:
{"moduleName":"...","description":"...","components":[{"name":"","responsibilities":[]}],"integrations":[{"from":"","to":"","trigger":"","async":false}],"apis":[],"notes":""}`,
      API_CONTRACT: `Convert the description into a structured API contract. Return ONLY a JSON object:
{"endpoint":"...","method":"GET","purpose":"...","requestSchema":{},"responses":{"200":{}},"authRequired":true,"notes":""}`,
      UX_DESIGN: `Convert the description into structured UX design information. Return ONLY a JSON object:
{"screen":"...","components":[{"name":"","componentType":"","interaction":"","required":false}],"exactCopy":{},"requiredFields":[],"notes":""}`,
      FUNCTIONAL_RULES: `Convert the description into structured functional rules. Return ONLY a JSON object:
{"summary":"...","fieldConstraints":["field: rule"],"dataRelationships":[],"knownFailureModes":["scenario → expected behavior"],"permissionScenarios":[],"functionalVariations":[],"notes":""}`,
      TEST_DATA: `Convert the description into structured test data. Return ONLY a JSON object:
{"datasets":[{"label":"...","values":{}}],"notes":""}`,
      USER_ROLE: `Convert the description into a structured user role definition. Return ONLY a JSON object:
{"roleName":"...","description":"...","permissions":[],"restrictions":[],"typicalWorkflows":[],"notes":""}`,
      UI_FLOW: `Convert the description into a structured UI flow. Return ONLY a JSON object:
{"flowName":"...","startUrl":"...","steps":[{"action":"","target":"","expectedOutcome":""}],"preconditions":[],"notes":""}`,
      LOCATOR_GUIDE: `Convert the description into a structured locator guide. Return ONLY a JSON object:
{"summary":"describe the locator conventions","locators":[{"pattern":"id pattern with {variable}","example":"concrete-id-123","notes":"when this pattern is used"}],"notes":""}`,
      TEST_CASE_DOC: `Convert the description into a structured test case document. Return ONLY a JSON object:
{"summary":"what feature is being tested","scenarios":[{"name":"scenario name","steps":["step 1","step 2"],"expectedResult":"","type":"happy path"}],"notes":""}`,
    };

    let extractedContent: string;

    const directClient = createAnthropicDirectClient();
    if (directClient) {
      const response = await directClient.messages.create({
        model: process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8',
        max_tokens: 2048,
        system: 'You are a QA analyst. Convert the plain-text description into structured JSON. Return ONLY a valid JSON object — no markdown fences, no explanation, no other text.',
        messages: [{ role: 'user', content: `Description:\n\n${text}\n\n${extractPrompts[skillType]}` }],
      });
      const textBlock = response.content.find((b): b is { type: 'text'; text: string } => b.type === 'text');
      const raw = (textBlock?.text ?? '').trim().replace(/^```json\n?|^```\n?|```$/gm, '').trim();
      try { JSON.parse(raw); extractedContent = raw; }
      catch { extractedContent = JSON.stringify({ raw: raw.slice(0, 2000), error: 'Could not parse — edit content manually' }); }
    } else {
      const llm = createLLM({ temperature: 0, agentName: 'writer-agent' });
      const response = await llm.invoke([
        new SystemMessage('You are a QA analyst. Convert the plain-text description into structured JSON. Return ONLY valid JSON — no markdown fences, no explanation.'),
        new HumanMessage(`Description:\n\n${text}\n\n${extractPrompts[skillType]}`),
      ]);
      const raw = String(response.content).trim().replace(/^```json\n?|^```\n?|```$/gm, '').trim();
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      try { const c = jsonMatch ? jsonMatch[0] : raw; JSON.parse(c); extractedContent = c; }
      catch { extractedContent = JSON.stringify({ raw: raw.slice(0, 2000), error: 'Could not parse — edit content manually' }); }
    }

    const skill = await prisma.projectSkill.create({
      data: {
        projectId: req.project.id,
        skillType,
        name,
        scope: scope ?? null,
        featureGroup: featureGroup ?? null,
        content: extractedContent,
        captureMethod: 'LLM_EXTRACTED',
        confidence: 0.75,
      },
    });
    if (skill.isActive) saveSkillFile(req.project.slug, skill.id, toSkillFileData(skill));

    res.status(201).json({ skill });
  } catch (err) {
    next(err);
  }
});

// ── POST /upload-skill-file — accept a raw JSON skill file ─────────────────

router.post('/upload-skill-file', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = UploadSkillFileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
      return;
    }
    const { skillType, name, scope, confidence } = parsed.data;

    const contentStr = typeof parsed.data.content === 'string'
      ? parsed.data.content
      : JSON.stringify(parsed.data.content);

    try {
      JSON.parse(contentStr);
    } catch {
      res.status(400).json({ error: 'content must be valid JSON' });
      return;
    }

    const skill = await prisma.projectSkill.create({
      data: {
        projectId: req.project.id,
        skillType,
        name,
        scope: scope ?? null,
        content: contentStr,
        captureMethod: 'MANUALLY_UPLOADED',
        confidence: confidence ?? 0.9,
      },
    });
    if (skill.isActive) {
      saveSkillFile(req.project.slug, skill.id, toSkillFileData(skill));
    }

    res.status(201).json({ skill });
  } catch (err) {
    next(err);
  }
});

// ── GET /features — list unique featureGroups for this project ─────────────

router.get('/features', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.projectSkill.findMany({
      where: { projectId: req.project.id, featureGroup: { not: null } },
      select: { featureGroup: true, skillType: true, isActive: true },
    });

    const groupMap = new Map<string, { total: number; active: number; types: Set<string> }>();
    for (const r of rows) {
      const fg = r.featureGroup!;
      if (!groupMap.has(fg)) groupMap.set(fg, { total: 0, active: 0, types: new Set() });
      const entry = groupMap.get(fg)!;
      entry.total++;
      if (r.isActive) entry.active++;
      entry.types.add(r.skillType);
    }

    const features = Array.from(groupMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, stats]) => ({
        name,
        skillCount: stats.total,
        activeCount: stats.active,
        skillTypes: Array.from(stats.types),
      }));

    res.json({ features });
  } catch (err) {
    next(err);
  }
});

// ── POST /generate-feature-tcs — SSE queued TC generation by feature ──────

router.post('/generate-feature-tcs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { featureGroup, additionalContext } = req.body as {
      featureGroup?: string;
      additionalContext?: string;
    };

    if (!featureGroup || !featureGroup.trim()) {
      res.status(400).json({ error: 'featureGroup is required' });
      return;
    }

    const skills = await prisma.projectSkill.findMany({
      where: { projectId: req.project.id, featureGroup: featureGroup.trim(), isActive: true },
      orderBy: [{ skillType: 'asc' }, { capturedAt: 'asc' }],
    });

    if (skills.length === 0) {
      res.status(400).json({ error: `No active skills found for feature group "${featureGroup}"` });
      return;
    }

    const existingTcs = await prisma.testCase.findMany({
      where: { projectId: req.project.id },
      select: { title: true },
    });
    const accumulatedTitles: string[] = existingTcs.map((tc) => tc.title);

    const libraryContext = await getLibraryContext(req.project.id).catch(() => '');

    // SSE setup
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const sendEvent = (event: string, data: object) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const allTestCases: import('../agents/writerAgent.js').GeneratedTestCase[] = [];

    sendEvent('start', { total: skills.length, featureGroup });

    for (let i = 0; i < skills.length; i++) {
      const skill = skills[i];

      sendEvent('progress', {
        step: i + 1,
        total: skills.length,
        skillName: skill.name,
        skillType: skill.skillType,
        status: 'generating',
      });

      try {
        const result = await runWriterAgent({
          inputs: [{
            type: 'feature_skill',
            content: `Generate comprehensive test cases for the "${skill.name}" flow. Cover all paths: happy path, all negative/validation scenarios, boundary conditions, and error cases relevant to this skill.`,
            label: `${featureGroup} — ${skill.name}`,
          }],
          projectName: req.project.name,
          projectLibraryContext: libraryContext,
          testTypes: ['UI'],
          additionalContext: additionalContext,
          existingTestCaseTitles: [...accumulatedTitles],
          skillsOverride: [{
            skillType: skill.skillType,
            name: skill.name,
            scope: skill.scope ?? undefined,
            content: skill.content,
            confidence: skill.confidence,
          }],
        });

        allTestCases.push(...result.testCases);
        accumulatedTitles.push(...result.testCases.map((tc) => tc.title));

        // Emit new TCs immediately so the frontend can show them as they arrive
        sendEvent('skill_result', {
          testCases: result.testCases,
          skillName: skill.name,
          step: i + 1,
          cumulativeCount: allTestCases.length,
        });

        sendEvent('progress', {
          step: i + 1,
          total: skills.length,
          skillName: skill.name,
          skillType: skill.skillType,
          status: 'done',
          tcCount: result.testCases.length,
          cumulativeCount: allTestCases.length,
        });
      } catch (err) {
        sendEvent('progress', {
          step: i + 1,
          total: skills.length,
          skillName: skill.name,
          skillType: skill.skillType,
          status: 'error',
          error: (err as Error).message?.slice(0, 200),
        });
      }
    }

    sendEvent('result', { testCases: allTestCases });
    sendEvent('done', { totalGenerated: allTestCases.length });
    res.end();
  } catch (err) {
    next(err);
  }
});

export default router;
