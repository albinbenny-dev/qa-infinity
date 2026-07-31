import { Worker, type Job } from 'bullmq';
import { prisma } from '../lib/prisma.js';
import { emitToProject } from '../lib/socket.js';
import { addScriptVerifyJob } from '../lib/queue.js';
import type { ScriptGenJobPayload } from '../lib/queue.js';
import { runScriptAgent } from '../agents/scriptAgent.js';
import { saveScript, savePOM, listPOMFiles, readScript, listResourceFiles, readResourceFile, listSkillFiles, readSkillFile } from '../services/scriptFileService.js';
import type { ResourceFileInfo } from '../agents/scriptAgent.js';
import { isAgentEnabled } from '../lib/agentConfig.js';
import { getLocatorsForScope, getKnownSelectorSet } from '../services/locatorRepository.js';
import { dryRunRobotScript } from '../services/dryRunGate.js';

/**
 * Strips Resource import lines for files that are not in the project's actual resource list.
 * LLMs hallucinate common RF resource filenames (Common.robot, LoginPage.robot, etc.) even
 * when explicitly told not to. Running this before lintRobotScript prevents file-not-found errors.
 */
function removePhantomResourceImports(content: string, resourceFiles: ResourceFileInfo[]): string {
  const validFilenames = new Set(resourceFiles.map(rf => rf.filename.toLowerCase()));
  return content
    .split('\n')
    .filter(line => {
      const m = line.trim().match(/^Resource\s+resources\/(.+\.robot)\s*$/i);
      if (!m) return true; // not a Resource import line — keep as-is
      const importedPath = m[1]; // e.g. "PageKeywords/Common.robot"
      const basename = importedPath.split('/').pop()!.toLowerCase();
      // Keep only if the full path OR the basename matches a known resource file
      return validFilenames.has(importedPath.toLowerCase()) || validFilenames.has(basename);
    })
    .join('\n');
}

/**
 * Post-generation lint for Robot Framework scripts.
 * For each available resource file, checks if the script calls any of its keywords
 * without importing it. Injects the missing Resource line into *** Settings ***.
 */
function lintRobotScript(content: string, resourceFiles: ResourceFileInfo[]): string {
  let result = content;
  for (const rf of resourceFiles) {
    const resourceLine = `Resource    resources/${rf.filename}`;
    if (result.includes(resourceLine)) continue; // already imported
    // Check if any keyword from this resource is called in the script body
    const called = rf.keywords.some((kw) => {
      // Match keyword call at line start (after 4+ spaces indent, i.e. inside test/keyword body)
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`^[ \\t]{2,}${escaped}([ \\t]|$)`, 'm').test(result);
    });
    if (!called) continue;
    // Inject after the last existing Library/Resource line in *** Settings ***
    result = result.replace(
      /((?:^Library[^\n]*\n|^Resource[^\n]*\n)+)/m,
      `$1${resourceLine}\n`,
    );
    // Fallback: inject at end of *** Settings *** block if no Library/Resource found
    if (!result.includes(resourceLine)) {
      result = result.replace(
        /(\*\*\* Settings \*\*\*[^\n]*\n)/,
        `$1${resourceLine}\n`,
      );
    }
  }
  return result;
}

// Matches a locator argument (css=/id=/role=/text=/xpath=) anywhere on a line —
// same shape as the extraction regex used to populate the repository, so what
// we compare against here is exactly what could have matched a known entry.
const LOCATOR_ARG_RE = /(?:css|id|role|text|xpath)=[^\s'"}{]+/g;

/**
 * Flags any locator the model wrote that isn't a known, repository-verified
 * selector for this project. Non-blocking by design: it annotates rather than
 * rejects, since a sparse/new-project repository would otherwise flag almost
 * everything. Skipped entirely when the repository has no entries yet.
 */
function flagUnknownLocators(content: string, knownSelectors: Set<string>): string {
  if (knownSelectors.size === 0) return content;
  return content
    .split('\n')
    .map((line) => {
      if (line.includes('NEW-LOCATOR')) return line;
      const matches = line.match(LOCATOR_ARG_RE);
      if (!matches) return line;
      const hasUnknown = matches.some((m) => !knownSelectors.has(m));
      if (!hasUnknown) return line;
      return `${line}  # NEW-LOCATOR: needs review`;
    })
    .join('\n');
}

function extractRobotKeywords(content: string): string[] {
  const keywords: string[] = [];
  let inKeywords = false;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('*** Keywords ***')) { inKeywords = true; continue; }
    if (trimmed.startsWith('***')) { inKeywords = false; continue; }
    // Keyword names start at column 0, not indented (indented lines are steps/docs)
    if (inKeywords && line.length > 0 && line[0] !== ' ' && line[0] !== '\t' && trimmed.length > 0 && !trimmed.startsWith('#')) {
      keywords.push(trimmed);
    }
  }
  return keywords;
}

function parseRedisUrl(url: string): { host: string; port: number; password?: string; db: number } {
  try {
    const u = new URL(url);
    return {
      host: u.hostname || 'localhost',
      port: parseInt(u.port || '6379', 10),
      password: u.password || undefined,
      db: parseInt(u.pathname.replace('/', '') || '0', 10),
    };
  } catch {
    return { host: 'localhost', port: 6379, db: 0 };
  }
}

async function emitJobUpdate(scriptJobId: string): Promise<void> {
  const job = await prisma.scriptJob.findUnique({
    where: { id: scriptJobId },
    include: {
      script: { select: { id: true, filename: true, verificationStatus: true, suspectedIssue: true } },
    },
  });
  if (!job) return;
  const testCase = await prisma.testCase.findUnique({
    where: { id: job.testCaseId },
    select: { id: true, tcId: true, title: true, type: true, useCaseTag: true },
  });
  emitToProject(job.projectId, 'script-job:update', { ...job, testCase });
}

async function processGenJob(job: Job<ScriptGenJobPayload>): Promise<void> {
  const { scriptJobId, projectId, testCaseId, withHeal, contextNote, qaFeedback, domSnippet, domRecording, failedStep, failedStepError, scriptMode = 'ROBOT', referenceTcIds, skillIds } = job.data;

  try {
    await prisma.scriptJob.update({
      where: { id: scriptJobId },
      data: { phase: 'GENERATING', updatedAt: new Date() },
    });
  } catch (e: unknown) {
    // P2025 — record was deleted (e.g. user hit Cancel All); silently discard
    if ((e as { code?: string }).code === 'P2025') return;
    throw e;
  }
  await emitJobUpdate(scriptJobId);

  const tc = await prisma.testCase.findFirst({
    where: { id: testCaseId, projectId },
    select: {
      id: true, projectId: true, tcId: true, title: true, description: true,
      steps: true, expectedResult: true, type: true, useCaseTag: true,
      generationHints: true, prerequisiteTcId: true, runtimeVariables: true,
    },
  });
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, slug: true, name: true, baseUrl: true, patternMemory: true },
  });
  if (!tc || !project) {
    await prisma.scriptJob.update({
      where: { id: scriptJobId },
      data: { phase: 'FAILED', lastError: 'Test case or project missing' },
    });
    await emitJobUpdate(scriptJobId);
    return;
  }

  try {
    const scriptAgentEnabled = await isAgentEnabled('script-agent');
    if (!scriptAgentEnabled) {
      await prisma.scriptJob.update({
        where: { id: scriptJobId },
        data: { phase: 'FAILED', lastError: 'Script Agent is disabled — enable it in AI Usage settings' },
      });
      await emitJobUpdate(scriptJobId);
      return;
    }

    const existingPOMs = scriptMode === 'ROBOT' ? [] : listPOMFiles(project.slug);
    const resourceFiles: ResourceFileInfo[] | undefined = scriptMode === 'ROBOT'
      ? (await listResourceFiles(project.slug)).map((f) => {
          let keywords: string[] = [];
          try {
            const content = readResourceFile(project.slug, f.filename);
            keywords = extractRobotKeywords(content);
          } catch { /* skip unreadable files */ }
          return { filename: f.filename, keywords };
        })
      : undefined;

    // Fetch prerequisite TC's script content if set — used to ground the agent with a working setup example
    let prerequisiteScript: { tcId: string; title: string; scriptContent: string } | undefined;
    if (tc.prerequisiteTcId) {
      const prereqScript = await prisma.script.findFirst({
        where: { testCaseId: tc.prerequisiteTcId, projectId },
        include: { testCase: { select: { tcId: true, title: true } } },
        orderBy: { updatedAt: 'desc' },
      });
      if (prereqScript && prereqScript.testCase) {
        let scriptContent = prereqScript.content;
        try {
          scriptContent = readScript(project.slug, prereqScript.filename);
        } catch {
          // file not on disk — fall back to DB content
        }
        prerequisiteScript = {
          tcId: prereqScript.testCase.tcId,
          title: prereqScript.testCase.title,
          scriptContent,
        };
      }
    }

    // For Robot scripts with no explicit prerequisite: auto-inject the login TC's script
    // so the LLM copies the proven login pattern (css=#username, Keyboard Input, etc.)
    // instead of regenerating login from the skill's rawPlaywrightCode.
    // Skip this search if a dedicated login skill already exists on disk —
    // the skill's MANDATORY LOGIN banner takes priority and a second login source causes confusion.
    const hasLoginSkill = listSkillFiles(project.slug).some(f => {
      try {
        const d = readSkillFile(project.slug, f);
        return d.skillType === 'UI_FLOW' &&
          (d.name.toLowerCase().includes('login') || (d.scope?.toLowerCase().includes('login') ?? false));
      } catch { return false; }
    });
    if (!prerequisiteScript && scriptMode === 'ROBOT' && !hasLoginSkill) {
      const loginScript = await prisma.script.findFirst({
        where: {
          projectId,
          scriptType: 'ROBOT',
          testCase: {
            OR: [
              { title: { contains: 'login', mode: 'insensitive' } },
              { useCaseTag: { contains: 'login', mode: 'insensitive' } },
              { tcId: { contains: 'login', mode: 'insensitive' } },
            ],
          },
        },
        include: { testCase: { select: { tcId: true, title: true } } },
        orderBy: { updatedAt: 'desc' },
      });
      if (loginScript?.testCase) {
        let scriptContent = loginScript.content;
        try {
          scriptContent = readScript(project.slug, loginScript.filename);
        } catch { /* fall back to DB content */ }
        prerequisiteScript = {
          tcId: loginScript.testCase.tcId,
          title: loginScript.testCase.title,
          scriptContent,
        };
      }
    }

    // Fetch recent approved/auto-applied heals to teach the agent which patterns to avoid
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // last 30 days
    const recentHealRows = await prisma.heal.findMany({
      where: {
        projectId,
        status: { in: ['APPROVED', 'AUTO_APPLIED'] },
        updatedAt: { gte: since },
      },
      include: {
        runResult: {
          include: { testCase: { select: { title: true, useCaseTag: true } } },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    });

    const recentHeals = recentHealRows.map((h) => ({
      type: h.type,
      summary: h.summary ?? '(no summary recorded)',
      tcTitle: h.runResult?.testCase?.title ?? undefined,
      useCaseTag: h.runResult?.testCase?.useCaseTag ?? undefined,
      confidence: h.confidence,
      timestamp: h.updatedAt.toISOString(),
    }));

    // Fetch user-selected reference scripts (passed via job payload, not persisted to TC)
    let referenceScripts: Array<{ tcId: string; title: string; scriptContent: string }> | undefined;
    if (referenceTcIds && referenceTcIds.length > 0) {
      const refRows = await prisma.script.findMany({
        where: { testCaseId: { in: referenceTcIds }, projectId },
        include: { testCase: { select: { tcId: true, title: true } } },
        orderBy: { updatedAt: 'desc' },
        distinct: ['testCaseId'],
      });
      const refs = refRows
        .filter((r) => r.testCase)
        .map((r) => {
          let scriptContent = r.content;
          try { scriptContent = readScript(project.slug, r.filename); } catch { /* fall back to DB */ }
          return { tcId: r.testCase!.tcId, title: r.testCase!.title, scriptContent };
        });
      if (refs.length > 0) referenceScripts = refs;
    }

    // Fetch explicitly pinned skills by ID — injected regardless of tier/featureGroup
    let pinnedSkills: Array<{
      skillType: string; name: string; scope: string | null;
      featureGroup?: string | null; tier?: string | null;
      humanContext?: string | null; content: string;
      confidence: number; captureMethod: string;
    }> | undefined;
    if (skillIds && skillIds.length > 0) {
      const rows = await prisma.projectSkill.findMany({
        where: { id: { in: skillIds }, projectId, isActive: true },
        select: {
          skillType: true, name: true, scope: true, featureGroup: true,
          tier: true, humanContext: true, content: true, confidence: true, captureMethod: true,
        },
      });
      if (rows.length > 0) pinnedSkills = rows;
    }

    // Object/Locator Repository — closed list of verified selectors for this TC's scope
    const locatorEntries = scriptMode === 'ROBOT'
      ? (await getLocatorsForScope(project.id, tc.useCaseTag)).map((e) => ({
          name: e.name, selector: e.selector, strategy: e.strategy,
          confidence: e.confidence, successCount: e.successCount,
        }))
      : undefined;

    const agentInputBase = {
      testCase: {
        id: tc.id,
        tcId: tc.tcId,
        title: tc.title,
        description: tc.description,
        steps: tc.steps,
        expectedResult: tc.expectedResult,
        type: tc.type,
        useCaseTag: tc.useCaseTag,
        generationHints: tc.generationHints,
      },
      project: { id: project.id, slug: project.slug, name: project.name, baseUrl: project.baseUrl },
      existingPOMs,
      contextNote,
      qaFeedback,
      domSnippet,
      domRecording,
      scriptMode,
      resourceFiles,
      recentHeals: recentHeals.length > 0 ? recentHeals : undefined,
      prerequisiteScript,
      referenceScripts,
      pinnedSkills,
      locatorEntries,
      patternMemory: project.patternMemory,
      runtimeVariables: tc.runtimeVariables
        ? (() => { try { return JSON.parse(tc.runtimeVariables as string); } catch { return null; } })()
        : null,
    };

    let result = await runScriptAgent({ ...agentInputBase, failedStep, failedStepError });

    const slug = tc.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    // Use content-derived type (not just requested mode) so an RF response never gets .spec.ts
    const isRobotContent = result.scriptType === 'ROBOT' || result.specContent.trimStart().startsWith('*** Settings ***');
    if (isRobotContent && result.scriptType !== 'ROBOT') {
      (result as any).scriptType = 'ROBOT';
    }
    const filename = isRobotContent
      ? `${tc.tcId}-${slug}.robot`
      : `${tc.tcId}-${slug}.spec.ts`;

    // Post-processing, extracted into a closure so the dry-run repair loop
    // below can re-apply the exact same fixups after each regeneration.
    const knownSelectors = isRobotContent ? await getKnownSelectorSet(project.id) : new Set<string>();
    const postProcess = (specContent: string): string => {
      let content = specContent;
      // Auto-inject missing Resource lines for any resource keywords called in the script,
      // and strip any invented Resource imports for files that don't exist in the project.
      if (isRobotContent && resourceFiles && resourceFiles.length > 0) {
        content = removePhantomResourceImports(content, resourceFiles);
        content = lintRobotScript(content, resourceFiles);
      } else if (isRobotContent) {
        // No resource files in project — remove ALL Resource imports (LLM may still invent them)
        content = content
          .split('\n')
          .filter(line => !/^\s*Resource\s+resources\//.test(line))
          .join('\n');
      }
      // Flag any locator that isn't a known, repository-verified selector — advisory
      // only (see flagUnknownLocators), so this never blocks generation.
      if (isRobotContent) {
        content = flagUnknownLocators(content, knownSelectors);
      }
      return content;
    };

    result.specContent = postProcess(result.specContent);
    saveScript(project.slug, filename, result.specContent, tc.useCaseTag);
    if (result.pomContent && result.pomFilename) {
      savePOM(project.slug, result.pomFilename, result.pomContent);
    }

    // ── Dry-run validation gate (Robot only) ──────────────────────────────
    // Fast, no-browser syntax/keyword-resolution check via `robot --dryrun`
    // (see services/dryRunGate.ts) — the default flow previously shipped a
    // generated script to the user with zero execution or syntax validation.
    // On failure, regenerate with the exact dry-run error fed back into the
    // SAME agent call chain (mirrors scriptVerifyWorker's heal loop), capped
    // so a persistently-broken generation escalates to a human instead of
    // looping forever.
    let dryRunSuspectedIssue: string | null = null;
    if (isRobotContent) {
      const MAX_DRYRUN_REPAIR_ATTEMPTS = 2;
      let attempt = 0;
      let dryRun = await dryRunRobotScript(project.slug, filename);
      while (!dryRun.passed && attempt < MAX_DRYRUN_REPAIR_ATTEMPTS) {
        attempt += 1;
        console.log(`[script-gen-worker] dry-run failed for ${tc.tcId} (repair attempt ${attempt}/${MAX_DRYRUN_REPAIR_ATTEMPTS}): ${dryRun.errorMessage}`);
        result = await runScriptAgent({
          ...agentInputBase,
          failedStep: 'Dry-run validation (robot --dryrun)',
          failedStepError: dryRun.errorMessage,
        });
        result.specContent = postProcess(result.specContent);
        saveScript(project.slug, filename, result.specContent, tc.useCaseTag);
        dryRun = await dryRunRobotScript(project.slug, filename);
      }
      if (!dryRun.passed) {
        dryRunSuspectedIssue = `Dry-run check still failing after ${attempt} repair attempt(s) — needs manual review. ${dryRun.errorMessage ?? ''}`.trim();
        console.warn(`[script-gen-worker] dry-run gate exhausted for ${tc.tcId}: ${dryRunSuspectedIssue}`);
      }
    }

    const existing = await prisma.script.findFirst({
      where: { projectId, testCaseId: tc.id },
    });

    const ucFolder = tc.useCaseTag ?? '_uncategorized';
    const script = existing
      ? await prisma.script.update({
          where: { id: existing.id },
          data: {
            filename,
            content: result.specContent,
            scriptType: result.scriptType,
            useCaseFolder: ucFolder,
            // withHeal takes over verification via the real execution pipeline below —
            // don't let the dry-run gate's preliminary flag get overwritten in that case.
            verificationStatus: withHeal ? 'NOT_VERIFIED' : (dryRunSuspectedIssue ? 'MANUAL_REVIEW' : existing.verificationStatus),
            suspectedIssue: withHeal ? null : (dryRunSuspectedIssue ?? existing.suspectedIssue),
            updatedAt: new Date(),
          },
        })
      : await prisma.script.create({
          data: {
            projectId,
            testCaseId: tc.id,
            filename,
            content: result.specContent,
            scriptType: result.scriptType,
            useCaseFolder: ucFolder,
            isCustomUpload: false,
            verificationStatus: (!withHeal && dryRunSuspectedIssue) ? 'MANUAL_REVIEW' : 'NOT_VERIFIED',
            suspectedIssue: withHeal ? null : dryRunSuspectedIssue,
          },
        });

    const runHeal = withHeal;
    if (runHeal) {
      await prisma.scriptJob.update({
        where: { id: scriptJobId },
        data: { scriptId: script.id, phase: 'QUEUED_VERIFY' },
      });
      await emitJobUpdate(scriptJobId);
      await addScriptVerifyJob({
        scriptJobId,
        projectId,
        testCaseId: tc.id,
        scriptId: script.id,
      });
    } else {
      await prisma.scriptJob.update({
        where: { id: scriptJobId },
        data: { scriptId: script.id, phase: 'GENERATED' },
      });
      await emitJobUpdate(scriptJobId);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[script-gen-worker] failed for TC ${testCaseId}:`, err);
    await prisma.scriptJob.update({
      where: { id: scriptJobId },
      data: { phase: 'FAILED', lastError: msg },
    });
    await emitJobUpdate(scriptJobId);
  }
}

export function startScriptGenWorker(): void {
  const connection = parseRedisUrl(process.env.REDIS_URL ?? 'redis://localhost:6379');

  const worker = new Worker<ScriptGenJobPayload>('script-gen', processGenJob, {
    connection,
    concurrency: 3, // up to 3 parallel AI script generations
  });

  worker.on('completed', (job) => {
    console.log(`[script-gen-worker] Job ${job.id} completed`);
  });
  worker.on('failed', (job, err) => {
    console.error(`[script-gen-worker] Job ${job?.id} failed:`, err.message);
  });

  console.log('[script-gen-worker] Worker started, listening on queue "script-gen"');
}
