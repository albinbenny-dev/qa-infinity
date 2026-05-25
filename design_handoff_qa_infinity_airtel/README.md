# Handoff: QA Infinity — Airtel Ventas Local Lab

## Overview

**QA Infinity** is an AI-native QA automation platform for Airtel's **Ventas** sales & distribution stack. It lets a QA Lead generate test cases from Jira/PRD/HLD sources, auto-author Playwright scripts, schedule and run them against a local lab environment, and use AI agents to triage failures and self-heal selector / flow drift.

This bundle is a **clickable HTML prototype** that demonstrates the intended look, layout, and primary interactions for 11 screens. Build the real product from it.

---

## About the Design Files

The files in this folder are **design references created in HTML** — interactive prototypes showing the intended look and behavior. They are **not production code to copy directly**.

- `QA-Infinity-Airtel-Ventas.html` — a single self-contained HTML bundle. Open in a browser to click through every screen.
- `source/index.html` — the un-bundled prototype source (same UI, links to `assets/`). Easier to inspect specific markup.
- `assets/6d-logo-white.png` — the official 6D Technologies logo (white-on-transparent). Used in the top brand banner.

Your task is to **recreate these designs in the target codebase's existing environment** (React, Vue, Angular, etc.) using its established patterns, component library, and conventions. If no environment exists yet, choose the most appropriate framework for the project (recommendation: React + TypeScript + Tailwind + shadcn/ui, or Next.js if SSR is wanted) and implement the designs there.

---

## Fidelity

**High-fidelity (hi-fi).** The prototype has final colors, typography, spacing, interactions, and content. Recreate the UI pixel-close using the codebase's existing libraries. The 6D Technologies brand system is binding — do not invent new colors or fonts.

---

## Brand & Design System (6D Technologies)

### Color tokens

```css
--6d-navy:        #0A2A57   /* primary anchor, headings, banner middle stop */
--6d-navy-deep:   #06224A   /* banner left edge, dark surfaces */
--6d-blue:        #2563AB   /* banner right edge, secondary brand / info */
--6d-blue-soft:   #DCE9F7   /* cool-group card tints, soft info bg */
--6d-orange:      #F47B20   /* primary signal — CTAs, stat numbers, tagline, active accents */
--6d-orange-deep: #D9601A   /* pressed/hover orange */
--6d-orange-soft: #FCE4CC   /* warm-group card tints */
--6d-gold:        #FFB347   /* warm gradient stops */
--6d-teal:        #2A9D8F   /* pass/success — used as the "target state" green */
--6d-ink:         #1F2937   /* body text */
--6d-muted:       #6B7280   /* captions, secondary text */
--6d-line:        #E5E7EB   /* borders, dividers */
--6d-bg:          #F7F9FC   /* slide / app canvas */
```

Composed gradients (reuse these):
- **Brand banner gradient:** `linear-gradient(90deg, #06224A 0%, #0A2A57 35%, #2563AB 100%)` — the navy bar at the top of every screen.
- **Warm card accent:** `linear-gradient(90deg, #FFB347, #F47B20)` — 4–6px top stripe on "warm" cards.
- **Cool card accent:** `linear-gradient(90deg, #2563AB, #0A2A57)` — 4–6px top stripe on "cool" cards.

### Status colors (semantic, brand-aligned)

```css
--pass: #2A9D8F   /* teal — last run passed */
--fail: #DC2626   /* red — last run failed */
--skip: #F47B20   /* orange — skipped / warning */
--run:  #2563AB   /* blue — currently running / info */
```

### Dark mode

The app supports a light/dark toggle (top-right of the brand banner). Light is the default. Dark mode uses:

```css
--bg:       #0a0e17
--surface:  #0f1623
--surface2: #141e30
--surface3: #1a2640
--border:   #1f2f48
--text:     #e2e8f0
--text-mid: #94a3b8
--text-dim: #64748b
```

Brand colors (navy banner, orange CTAs) stay constant across both themes. Preference is persisted in `localStorage` under the key `qai-theme`.

### Typography

- **UI font:** Open Sans (Google Fonts, weights 400/500/600/700/800). Fallback chain: `'Inter', 'Lato', system-ui, sans-serif`.
- **Mono font:** JetBrains Mono (for code, IDs, timestamps, env URLs).
- **Base body:** 14px / line-height 1.55, antialiased.
- **Scale:**
  - Page title: 24px / 800
  - Card title: 14px / 700
  - Nav item: 13.5px / 500
  - Body / table cells: 13–13.5px / 500
  - Eyebrow + section label: 10–11px / 700 / uppercase / 1.3–1.5px letter-spacing
  - Stat number: 22–28px / 800 (orange or themed)
  - Badge: 10px / 700 / uppercase

### Spacing & shape

- Base radius: 8px. Larger cards: 12px. Pills: 100px.
- Card border: `1px solid var(--6d-line)` + `box-shadow: 0 2px 6px rgba(15,25,50,0.05)`.
- Card top accent: 4–6px stripe (warm or cool gradient). Alternate accents across a grid to create the signature 6D rhythm.
- Stat tiles: white card + small icon chip (44×44px, soft warm/cool tint) + big orange number + caption.

### Brand chrome rules (do not violate)

1. Every screen sits below a **full-width navy brand banner** with the 6D logo at the right edge. Do not stretch or recolor the logo.
2. Tagline is *Smart Ideas, Delivered.* — the word **Ideas** is always italic.
3. Cards use coloured top accents (warm or cool), not coloured fills. Body stays white in light, `--surface` in dark.
4. Orange is the signal color — reserve it for primary CTAs, stat numbers, tagline emphasis, and active accents. Don't paint navigation containers orange.
5. No decorative diagonal hatch, dot-grid, or texture overlays. The brand is clean: gradient + clean type + cards.

---

## Screens / Views

The prototype has **11 screens**, navigated via the top "Screens" switcher bar and the left sidebar. Each screen shares the same chrome: full-width navy brand banner → screen switcher → sidebar + main content area.

### 1. Dashboard (`#screen-dashboard`)

**Purpose:** Snapshot of the active project — total tests, pass/fail of last run, scheduled runs, scripts generated, recent run timeline, agent health.

**Layout:**
- Top breadcrumb bar (All Projects / Project / Dashboard)
- Project context strip with the project chip + Switch Project / Settings links
- 5-up stat tiles row (Total / Pass / Fail / Scheduled / Scripts Generated)
- 3-column grid below:
  - 7-day Pass/Fail bar chart
  - Recent Runs list (4 rows with status icon, name, meta, progress bar, pass-rate badge)
  - Agent Status panel (Test Writer / Script Agent / Execution / Healing / Reports) with status dots + badges

### 2. Test Writer (`#screen-writer`)

**Purpose:** Generate test cases from multiple input sources via AI.

**Layout (3 columns):**
- **Left (420px):** Multi-input panel with:
  - Multiple Jira stories (add/remove rows, each with ✓ verify + ✕ delete)
  - Reference test cases (existing suites the AI should pattern off)
  - Document upload list + drop zone
  - Additional context (textarea)
  - Test types to generate (UI / API / SIT chips)
  - **✨ Generate Test Cases** button (orange gradient)
- **Middle:** Generated Test Cases list (search, tag filters, checkbox rows, edit/delete actions, "Select All" + "→ Generate Scripts" footer)
- **Right (260px):** Project Docs Reference (HLD / PRD / API spec loaded from the project Source Path) + Agent Context panel showing what AI has loaded

### 3. TC Library (`#screen-tc-library`)

**Purpose:** Manage the full library of test cases organised into **UseCase groups**.

**Layout:**
- 5-up stat tiles (Total TCs / UseCases / Last Pass / Last Fail / Never Run)
- Filter bar (search, type filter, status filter, drag-mode toggle, expand/collapse all)
- Selection action bar (appears when items are selected): selected count + **Move to UseCase** dropdown + **↗ Move** button + Clear selection + **▶ Send to Execution**
- "Create New UseCase" modal triggered from the Move dropdown
- UseCase groups rendered from JS data (`groups` array near the bottom of `<script>`). Each group is collapsible, has a coloured status dot, header with selected/total + pass/fail counts + "▶ Run Group", and rows of TCs.
- **UseCases used in the prototype:** Primary Sales · Stock Management · Dealer Onboarding & KYC · Sales API · Secondary Sales · Distributor API

### 4. Script Agent (`#screen-scripts`)

**Purpose:** Review and edit auto-generated Playwright scripts.

**Layout (2 columns):**
- **Left (280px):** File tree (AI Generated section + Custom Uploads section), each row with a status dot
- **Right:** Editor area
  - Tabs (closable) → `primary-sales.spec.ts`, `PrimarySalesPage.ts`, `api-stock.spec.ts`
  - Code area: **always dark navy bg** with syntax-highlighted TypeScript (keep dark in both themes for contrast)
  - Status bar with TypeScript + linter status + file name

### 5. Execution Planner (`#screen-execution`)

**Purpose:** Pick environment + suites + workers, schedule, and watch the live log.

**Layout (2 columns):**
- **Left:** Target Environment (Dev / QA / Staging / Prod toggle + base URL), Suite Selection (Smoke / Regression / API / SIT), Run Options (parallel workers stepper, Browser toggle, Headless / Auto-heal / AI Agents toggles), Schedule (cron 5-field input + readable explanation)
- **Right:** **Run Now** big button (teal gradient), Live Execution Log (dark navy panel — keep dark in both themes), 4 mini-stat tiles below (Passed / Failed / Running / Elapsed)

### 6. Healing Agent (`#screen-healing`)

**Purpose:** Review and approve AI-proposed fixes for failed/drifted tests.

**Layout (2 columns):**
- **Left:** Pending Approval list of `.heal-item` cards. Each card:
  - Left rail (red = critical, orange = warning, teal = healed)
  - TC id + name + error message (red rail)
  - Heal type tag (Selector Change / Flow Change / API Schema Drift)
  - Diff block (red `-` lines, teal `+` lines)
  - Confidence bar + percentage
  - Actions: **✓ Approve · ✗ Reject · View Full Diff**
- **Right:** Recently Healed table (TC / Type / Confidence / Time / Status) + AI Summary panel

### 7. Reports (`#screen-reports`)

**Purpose:** Trend analytics, expanded run history, email digest config, flaky test radar.

**Layout (2 columns):**
- **Left column:** 30-day run history bar chart with 7d/30d/90d range tabs · Expandable Run History rows (clicking a row reveals a sub-table of TCs in that run) · Flaky Test Radar table
- **Right column:** AI Failure Analysis · Email Recipients · plus other analytics

### 8. Chat Agent (`#screen-chat`)

**Purpose:** Natural-language interface to all the other agents.

**Layout (2 columns):**
- **Left:** Chat window — header (status dot + claude model), messages (AI on left with orange-bordered action cards, user on right with orange-filled bubble), textarea + orange send button
- **Right (300px):** Quick Commands grouped (Execution / Analysis / Creation) + Context panel (env / last run / pending heals / AI mode)

### 9. All Projects / Global (`#screen-global`)

**Purpose:** Org-level project picker.

**Layout:**
- 5-up global stats (Total Projects / Pass Rate / Open Failures / Pending Heals / Scheduled Runs)
- 2-column grid of project cards. Each card: gradient icon tile, name + slug, badge (Active / Pass-rate), description, 4 mini-stats (Tests / Passing / Failing / Heals), tag row, last-run timestamp
- "+ Create New Project" CTA at the bottom

### 10. Project Settings (`#screen-project-home`)

**Purpose:** Configure the active project.

**Layout (2 columns):**
- **Left:** Project Details (name, slug, description, icon/color), Environments table (QA / Staging / Dev with Default toggle), Source Path config (the requirement docs folder — HLD/PRD/API spec)
- **Right:** Project Members table, Integrations (Jira / SMTP / Slack), Danger Zone (Archive / Delete)

### 11. Copy / Export (`#screen-copy-export`)

**Purpose:** Copy TCs and scripts between projects + import/export.

**Layout (2 columns):**
- **Left:** Copy to Another Project — what-to-copy checkboxes (Test Cases / Scripts / Schedule), target project picker (radio cards), Conflicts Detected warning panel with Overwrite/Rename/Skip actions, **Copy N Items** CTA
- **Right:** Export options (Excel / Script .zip / JSON snapshot / Save as Template), Import drop zone, New from Template list

---

## Interactions & Behavior

- **Screen switching:** click any sidebar nav item OR any top switcher button. Both keep active state in sync.
- **Theme toggle:** click the pill in the brand banner top-right. Adds `data-theme="dark"` to `<html>` and persists to `localStorage` (`qai-theme`).
- **Filters & search:** filter pills and the search input filter the rendered list live (no debounce in the prototype — fine to add 150–250ms debounce in production).
- **Multi-select + bulk actions:** checking TC rows reveals the action bar / floating dock. Bulk run hops the user to Execution Planner. Bulk delete shows a confirm modal.
- **Generate Test Cases (Test Writer):** clicking shows a 5-step AI progress overlay, then prepends new TC items with a fade-in animation; updates the "X cases" header and the Dashboard total.
- **Run Now (Execution):** clears the log, animates a streamed run (~6s scripted scenario), increments pass/fail counters, then shows a completion toast with a "Review Healing" or "View Reports" CTA depending on outcome.
- **Approve a heal:** marks the heal item resolved, decrements the pending counter in the heal screen + the nav badge + the dashboard, and prepends a row to the Recently Healed table.
- **Send a chat:** echoes the user message, shows a 3-dot typing indicator, then responds with an intent-matched AI reply that may include an embedded action card with `data-jump` links to other screens.
- **TC Library "Move to UseCase":** select rows → pick target from dropdown → click Move → toast confirms. Selecting "+ Create New UseCase" opens a modal with a single text input.
- **Drag mode (TC Library):** when on, you can drag TC rows between UseCase groups. A floating ghost follows the cursor.

---

## State Management

State needed (per screen / cross-cutting):

- **Global:** active project id, theme (light/dark), current user, list of UseCases per project.
- **Test Cases:** array of TCs with `{ id, title, type, suite, status, lastRunAt, useCaseId, tags, jira }`. Multi-select via a Set of TC ids.
- **Execution run:** `isRunning` bool, current passed/failed/running counts, elapsed seconds, log lines (`{ ts, kind, text }`).
- **Healing:** array of heal proposals with `{ tcId, type: 'selector'|'flow'|'api', error, diff, confidence, status: 'pending'|'approved'|'rejected' }`. Approving moves to "healed" list.
- **Chat:** message history `[{ role, text, card?, time }]`. Persist per-project.
- **Filters:** `{ search, type, status, suite, useCaseFilter }` per list view.

In React, an `useReducer` per screen + a thin `TestCasesContext` / `ExecutionContext` is enough; no need for Redux. TanStack Query for the API layer.

---

## Data Model (for backend / API design)

```ts
type Project       = { id, name, slug, description, icon, envs: Environment[], members: Member[], integrations: {...} }
type Environment   = { id, name: 'Dev'|'QA'|'Staging'|'Prod', baseUrl, isDefault }
type UseCase       = { id, projectId, name, color, order }
type TestCase      = { id, projectId, useCaseId, title, jiraKey, type: 'ui'|'api'|'sit', suite: 'smoke'|'regression'|'api'|'sit', tags: string[], steps: Step[], scriptPath, lastRun?: RunResult }
type Step          = { idx, action, expected }
type Script        = { id, tcId, language: 'ts', path, content, generatedBy: 'ai'|'upload', healVersion }
type Run           = { id, projectId, suite, env, status: 'queued'|'running'|'passed'|'failed'|'mixed', startedAt, finishedAt, workerCount, browser, parallel, schedule?: cron, results: RunResult[] }
type RunResult     = { tcId, status: 'pass'|'fail'|'skip', durationMs, errorTrace?, screenshotUrl? }
type HealProposal  = { id, tcId, runId, kind: 'selector'|'flow'|'api', errorText, oldSnippet, newSnippet, confidence: 0–1, status: 'pending'|'approved'|'rejected', appliedAt? }
type ChatMessage   = { id, projectId, role: 'user'|'agent', text, card?, createdAt }
type AgentStatus   = { agent: 'writer'|'scripts'|'execution'|'healing'|'reports', state: 'idle'|'busy'|'pending', message?, since }
```

Suggested API surface (REST or GraphQL):

```
GET    /projects
GET    /projects/:id
GET    /projects/:id/usecases
POST   /projects/:id/usecases
GET    /projects/:id/testcases?useCaseId=&status=&search=
POST   /projects/:id/testcases:generate     { sources: { jira[], docs[], context } } -> async job
POST   /projects/:id/testcases:bulk-move    { ids[], targetUseCaseId }
POST   /projects/:id/testcases:run          { ids[], env, browser, workers } -> runId
GET    /runs/:runId                         -> with results
GET    /runs/:runId/log?since=ts            -> SSE stream of log lines
GET    /projects/:id/heals?status=pending
POST   /heals/:id:approve
POST   /heals/:id:reject
POST   /chat/:projectId/messages
GET    /chat/:projectId/messages?cursor=
```

For the live execution log, **Server-Sent Events** is the right primitive (one-way, reconnect built-in, plays nicely with HTTP/2). Skip WebSockets unless you also need bidirectional chat from the same connection.

---

## Recommended stack (if greenfield)

- **Framework:** React 19 + TypeScript + Vite (or Next.js 15 if SSR/SEO matters for a marketing surface)
- **Styling:** Tailwind v4 with the 6D tokens above mapped to `theme.extend.colors` (`navy`, `navy-deep`, `blue`, `orange`, `orange-deep`, `orange-soft`, `gold`, `teal`, `ink`, `muted`, `line`)
- **Components:** shadcn/ui (Radix primitives + tailwind) — drop-in cards, dropdowns, dialogs, toast, dropdown-menu. Override the default radii to 8px and the focus ring to `--6d-orange`.
- **Icons:** lucide-react (don't use emoji in the production UI — the prototype uses them as placeholders).
- **State:** TanStack Query for server state + `useReducer` + small contexts for UI state.
- **Charts:** Recharts (the bar chart on Dashboard) or Visx if you want more control.
- **Code editor:** Monaco (if real editing) or simple syntax highlighting via Shiki (if read-only).
- **Forms:** react-hook-form + zod.
- **Backend (suggestion):** FastAPI or NestJS, with Playwright runners orchestrated via a job queue (BullMQ / Sidekiq / Celery). Postgres for state. Object storage for traces/screenshots.
- **AI:** Anthropic Claude (Sonnet for the agents) — call from the backend, never from the browser.

---

## Design Tokens — Tailwind config snippet

```ts
// tailwind.config.ts (extends)
export default {
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: '#0A2A57', deep: '#06224A' },
        blue: { DEFAULT: '#2563AB', soft: '#DCE9F7' },
        orange: { DEFAULT: '#F47B20', deep: '#D9601A', soft: '#FCE4CC' },
        gold: '#FFB347',
        teal: '#2A9D8F',
        ink: '#1F2937',
        muted: '#6B7280',
        line: '#E5E7EB',
        canvas: '#F7F9FC',
      },
      fontFamily: {
        ui: ['"Open Sans"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        card: '0 2px 6px rgba(15, 25, 50, 0.05)',
        elevated: '0 12px 32px rgba(15, 25, 50, 0.15)',
      },
      backgroundImage: {
        'banner-6d': 'linear-gradient(90deg, #06224A 0%, #0A2A57 35%, #2563AB 100%)',
        'warm-accent': 'linear-gradient(90deg, #FFB347, #F47B20)',
        'cool-accent': 'linear-gradient(90deg, #2563AB, #0A2A57)',
      },
    },
  },
}
```

---

## Assets

- `assets/6d-logo-white.png` — 6D Technologies logo, white-on-transparent, 1101×201 (≈ 5.5 : 1 aspect ratio). **Preserve native aspect ratio** — set only width OR height when rendering. The logo lock-up already includes the "Smart *Ideas*, Delivered" tagline beneath the wordmark.

Other product marks (Canvas / Magik / Ventas / Infinity / Lynx / Aureus) can be sourced from the official 6D-design-language asset pack if a "Part of the 6D Platform" footer is added later. They were intentionally removed from this design.

Emojis used in the prototype (sidebar icons, status indicators, breadcrumbs) are placeholders — replace with `lucide-react` icons or the codebase's icon system in production.

---

## How to use this handoff with Claude Code

1. Open Claude Code in the target repo (or run `claude` in the repo root).
2. Add this handoff folder to your context: drop it into the project, or reference it explicitly:
   ```
   Please open design_handoff_qa_infinity_airtel/QA-Infinity-Airtel-Ventas.html in a browser
   and read design_handoff_qa_infinity_airtel/README.md. We're going to build this app in our
   existing <stack here> codebase, screen-by-screen.
   ```
3. Work screen-by-screen. Prompts that work well:
   - *"Implement the Dashboard screen from the handoff. Use our existing `<Card>`, `<StatTile>`, and chart components — create new ones only if the design needs something we don't have. Match the design tokens in the README."*
   - *"Build the Test Cases (TC Library) screen. Start with the data model + types, then the filter bar, then the UseCase group component. Hold off on the drag-to-move interaction — we'll do that in a follow-up."*
   - *"Wire up the Run Now flow on the Execution screen. Backend exposes `POST /runs` and an SSE stream at `/runs/:id/log`. Stream incoming log lines into the dark log panel."*
4. When something looks off, **screenshot the prototype side-by-side with your implementation** and ask Claude Code to reconcile. The prototype is the source of truth for layout and color.
5. If you change a design token, update both the Tailwind config AND this README so the next handoff stays accurate.

---

## Files in this handoff

- `README.md` — this document
- `QA-Infinity-Airtel-Ventas.html` — single-file bundled prototype (open in any browser)
- `source/index.html` — un-bundled source HTML (links to local `assets/`)
- `assets/6d-logo-white.png` — official 6D Technologies logo

Open the bundled HTML first to feel the product. Read the README before writing code. Refer back to the source when you need to copy exact markup, computed values, or component class names.
