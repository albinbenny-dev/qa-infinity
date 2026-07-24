import { useState, useRef, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import Topbar, { TbBtn } from '../components/layout/Topbar';
import { useProject, useProjectEnvConfigs } from '../hooks/useProjects';
import {
  useSkills,
  useCreateSkill,
  useUpdateSkill,
  useDeleteSkill,
  useStartRecording,
  useStopRecording,
  useCancelRecording,
  useExtractSkillFromDoc,
  useConvertSkillFromText,
  useFeatureGroups,
} from '../hooks/useSkills';
import { useUploadFile, useSaveTestCases } from '../hooks/useTestCases';
import { getToken } from '../lib/auth';
import { useQueryClient } from '@tanstack/react-query';
import type { ProjectSkill, SkillType } from '../types';

// ── Combo input (styled autocomplete) ────────────────────────────────────

function ComboInput({
  value,
  onChange,
  options,
  placeholder,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  style?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const filtered = options.filter((o) =>
    o.toLowerCase().includes(value.toLowerCase())
  );

  return (
    <div ref={ref} style={{ position: 'relative', ...style }}>
      <input
        className="input-field"
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        style={{ width: '100%', boxSizing: 'border-box', fontSize: 12 }}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          zIndex: 999,
          background: 'var(--surface)',
          border: '1px solid var(--border2)',
          borderRadius: 'var(--radius)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          marginTop: 3,
          maxHeight: 200,
          overflowY: 'auto',
        }}>
          {filtered.map((opt) => (
            <div
              key={opt}
              onMouseDown={(e) => { e.preventDefault(); onChange(opt); setOpen(false); }}
              style={{
                padding: '8px 12px',
                fontSize: 12,
                cursor: 'pointer',
                color: 'var(--text)',
                borderBottom: '1px solid var(--border)',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--surface2)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
            >
              {opt}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Skill type metadata ───────────────────────────────────────────────────

const SKILL_META: Record<
  SkillType,
  { icon: string; label: string; color: string; dim: string; description: string }
> = {
  UI_FLOW: {
    icon: '🖥',
    label: 'UI Flow',
    color: 'var(--emerald)',
    dim: 'var(--emerald-dim)',
    description: 'Real selectors, navigation paths, state transitions, wait conditions',
  },
  BUSINESS_USE_CASE: {
    icon: '📋',
    label: 'Business Use Case',
    color: 'var(--violet)',
    dim: 'var(--violet-dim)',
    description: 'Business rules, acceptance criteria, edge cases, actors',
  },
  TEST_DATA: {
    icon: '🗄',
    label: 'Test Data',
    color: 'var(--amber)',
    dim: 'rgba(245,158,11,0.08)',
    description: 'Valid/invalid data sets, boundary values, reference data',
  },
  HLD: {
    icon: '🏗',
    label: 'HLD / Architecture',
    color: 'var(--cyan)',
    dim: 'var(--cyan-dim)',
    description: 'Modules, integrations, async flows, system components',
  },
  API_CONTRACT: {
    icon: '🔌',
    label: 'API Contract',
    color: 'var(--sky)',
    dim: 'rgba(14,165,233,0.08)',
    description: 'Endpoints, request/response schemas, error codes',
  },
  USER_ROLE: {
    icon: '👤',
    label: 'User Role',
    color: 'var(--rose)',
    dim: 'var(--rose-dim)',
    description: 'Role permissions, test credentials, restricted features',
  },
  UX_DESIGN: {
    icon: '🎨',
    label: 'UX Design',
    color: '#a78bfa',
    dim: 'rgba(139,92,246,0.08)',
    description: 'Component types, exact copy text, required fields',
  },
  HISTORICAL: {
    icon: '📈',
    label: 'Historical',
    color: 'var(--text-dim)',
    dim: 'var(--surface2)',
    description: 'Auto-accumulated from past run failures and heals',
  },
  FUNCTIONAL_RULES: {
    icon: '⚙',
    label: 'Functional Rules',
    color: '#f59e0b',
    dim: 'rgba(245,158,11,0.08)',
    description: 'Business rules, data relationships, failure modes, permission scenarios, functional variations',
  },
  LOCATOR_GUIDE: {
    icon: '🔖',
    label: 'Locator Guide',
    color: 'var(--cyan)',
    dim: 'var(--cyan-dim)',
    description: 'Element ID patterns, naming conventions, and component locator strategies for this app',
  },
  TEST_CASE_DOC: {
    icon: '📄',
    label: 'Test Case Doc',
    color: 'var(--violet)',
    dim: 'var(--violet-dim)',
    description: 'High-level test case document — scenarios, acceptance criteria, edge cases',
  },
};

const SKILL_TYPES = Object.keys(SKILL_META) as SkillType[];

const SKILL_TEMPLATES: Record<SkillType, string> = {
  UI_FLOW: JSON.stringify(
    {
      flowName: 'Create Order',
      targetUrl: '/#/feature/page',
      navigationPath: ['Menu Item > Sub Menu'],
      steps: [
        { action: 'fill', target: 'Product search field', value: 'SIM-STD-100', expectedOutcome: 'Product appears in dropdown' },
        { action: 'click', target: 'Submit Order button', expectedOutcome: 'Order confirmation screen appears' },
        { action: 'capture', target: 'Order ID shown in confirmation header', captureAs: 'orderId', expectedOutcome: 'Order ID stored for reuse in subsequent steps' },
        { action: 'fill', target: 'Search field on Order Tracking screen', value: '{{orderId}}', expectedOutcome: 'Search field pre-filled with captured Order ID' },
      ],
      locators: [
        { semanticName: 'submit button', selector: "button[data-testid='submit']", locatorType: 'css' },
      ],
      loginRequired: true,
      notes: 'Use captureAs to store runtime values. Reference them with {{varName}} in later step values.',
    },
    null,
    2,
  ),
  BUSINESS_USE_CASE: JSON.stringify(
    {
      useCaseName: '',
      actors: ['User'],
      preconditions: [],
      businessRules: [],
      successCriteria: [],
      edgeCases: [],
      relatedScreens: [],
      priority: 'MEDIUM',
      notes: '',
    },
    null,
    2,
  ),
  TEST_DATA: JSON.stringify(
    {
      scope: '',
      validData: {},
      invalidData: {},
      boundaryValues: {},
      referenceData: {},
      dataSetupInstructions: '',
    },
    null,
    2,
  ),
  HLD: JSON.stringify(
    {
      moduleName: '',
      description: '',
      components: [],
      integrations: [],
      apis: [],
      notes: '',
    },
    null,
    2,
  ),
  API_CONTRACT: JSON.stringify(
    {
      endpoint: '/api/v1/resource',
      method: 'POST',
      purpose: '',
      requestSchema: {},
      responses: { '201': {}, '400': {}, '401': {} },
      authRequired: true,
      notes: '',
    },
    null,
    2,
  ),
  USER_ROLE: JSON.stringify(
    {
      roleName: '',
      testCredentials: { username: '', password: '' },
      permissions: [],
      restrictions: [],
      visibleMenuItems: [],
      hiddenMenuItems: [],
      notes: '',
    },
    null,
    2,
  ),
  UX_DESIGN: JSON.stringify(
    {
      screen: '',
      components: [],
      exactCopy: {},
      requiredFields: [],
      notes: '',
    },
    null,
    2,
  ),
  HISTORICAL: '{}',
  FUNCTIONAL_RULES: JSON.stringify(
    {
      summary: 'What this feature does in 1-2 sentences',
      fieldConstraints: ['PO Number: unique per warehouse+month', 'Quantity: positive integer only'],
      dataRelationships: ['Warehouse dropdown shows only user-assigned warehouses', 'Product code must exist in selected warehouse'],
      knownFailureModes: ['PO number already used → error banner, form does not clear', 'Product not in warehouse → save button stays disabled'],
      permissionScenarios: ['Warehouse Manager: full access', 'Stock Clerk: create but not approve', 'Read Only: no access to create form'],
      functionalVariations: ['Create with min quantity (1)', 'Create when warehouse has 0 stock', 'Create with duplicate serial numbers'],
      notes: '',
    },
    null,
    2,
  ),
  LOCATOR_GUIDE: JSON.stringify(
    {
      summary: 'Describe the ID/locator conventions used in this app',
      locators: [
        { pattern: 'sixdee-sidemenu-sub-menu-link-{item.id}', example: 'sixdee-sidemenu-sub-menu-link-primary-sales', notes: 'Sidebar sub-menu links' },
        { pattern: 'sixdee_field_input_{fieldName}', example: 'sixdee_field_input_quantity', notes: 'Dynamic form fields' },
      ],
      notes: '',
    },
    null,
    2,
  ),
  TEST_CASE_DOC: JSON.stringify(
    {
      summary: 'High-level test case document for this feature',
      scenarios: [
        { name: 'Happy path — create order with valid data', steps: ['Navigate to feature', 'Fill all required fields', 'Submit', 'Verify success message'] },
        { name: 'Negative — missing mandatory field', steps: ['Leave required field empty', 'Submit', 'Verify error message'] },
      ],
      notes: '',
    },
    null,
    2,
  ),
};

const PLAIN_TEXT_PLACEHOLDERS: Record<SkillType, string> = {
  BUSINESS_USE_CASE: 'Describe the business process in plain English.\n\nExample:\n"The stock creation process allows warehouse managers to receive new inventory. They scan a delivery note, select products from the catalogue, enter quantities, and confirm. The system validates against the PO and updates inventory. Auto-approval triggers after 30 minutes if PO matches."',
  HLD: 'Describe the module, its components, how they connect, and any key rules.\n\nExample:\n"Primary Sales handles sales from operator to distributors. Main components are POS (order entry), ROM (order management), ARM (inventory), and ESB (middleware). POS sends orders to ROM which validates and routes to ARM for stock. ERP sync happens async every 30 minutes. Auto-approval after 30 mins, auto-cancel after 48 hrs."',
  API_CONTRACT: 'Describe the API — what it does, its URL, method, what you send, and what you get back.\n\nExample:\n"POST /api/orders/create — Creates a new sales order. Requires auth token. Body needs productId, quantity, distributorId, warehouseId. Returns orderId and status. Returns 400 if product not in catalogue, 422 if insufficient stock."',
  UX_DESIGN: 'Describe the screen layout, fields, buttons, and how the user interacts with it.\n\nExample:\n"Stock creation form has a header with title and Cancel/Save buttons. Left side has a product search dropdown and quantity input. Right side shows a preview of selected items with totals. Save is disabled until at least one product is added. Success shows a green banner with the stock reference number."',
  FUNCTIONAL_RULES: 'List the business rules, validations, and conditions that apply to this feature.\n\nExample:\n"PO number is mandatory and must match an approved PO in the system. Quantity cannot exceed PO remaining balance. Duplicate serial numbers within the same GRN are rejected. Warehouse Manager can create and approve; Stock Clerk can only create. Auto-approval triggers if PO balance covers full order amount and no manual override is set."',
  TEST_DATA: 'List the test data you want to capture — accounts, credentials, products, amounts, etc.\n\nExample:\n"Distributor accounts: dist_001 (active), dist_002 (suspended), dist_003 (zero balance). Test products: SIM-STD-100 (physical), EPIN-500 (virtual). PO numbers: PO-2024-001 (approved), PO-2024-002 (expired). Admin credentials: admin@test.com / Test@1234."',
  USER_ROLE: 'Describe the user role — what they can do, what they cannot do, and their typical workflow.\n\nExample:\n"Warehouse Manager: can create, edit, approve, and cancel stock orders. Cannot delete approved orders. Typical flow: receive delivery → create GRN → approve → stock reflects in system. Cannot access financial reports or user management."',
  UI_FLOW: 'Describe the flow step by step — starting page, what to click, what to fill in, and what you expect to see.\n\nIf the flow involves capturing a runtime value (like an order ID or serial number) and reusing it in a later step, describe that explicitly.\n\nExample:\n"Login as warehouse manager. Go to Inventory > Stock In. Click New GRN. Search for the PO number PO-2024-001. Select products and enter quantities. Click Save. Capture the GRN reference number shown on the confirmation screen. Navigate to Order Tracking. Paste the captured GRN number into the search field and verify the order appears."',
  HISTORICAL: '',
  LOCATOR_GUIDE: 'Describe the element ID / locator conventions used in this app.\n\nExample:\n"Sidebar links use the pattern sixdee-sidemenu-sub-menu-link-{item.id}. Form inputs use sixdee_field_input_{fieldName}. Action buttons use data-testid=\"btn-{action}-{entity}\". Table rows use data-row-key=\"{rowId}\"."',
  TEST_CASE_DOC: 'Describe the test scenarios for this feature in plain English.\n\nExample:\n"Happy path: navigate to the create screen, fill all required fields with valid data, submit, verify success message and record appears in the list. Negative: leave a required field empty, verify inline error. Edge case: submit with minimum allowed values (quantity=1), verify accepted. Permission: log in as read-only user, verify create button is absent."',
};

// ── ConfidenceBar ─────────────────────────────────────────────────────────

function ConfidenceBar({ value }: { value: number }) {
  const level = value >= 0.85 ? 'high' : value >= 0.65 ? 'medium' : 'low';
  const color =
    level === 'high' ? 'var(--emerald)' : level === 'medium' ? 'var(--amber)' : 'var(--rose)';
  const label = level === 'high' ? 'Verified' : level === 'medium' ? 'Likely' : 'Unverified';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div
        style={{
          flex: 1,
          height: 3,
          background: 'var(--surface3)',
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${value * 100}%`,
            height: '100%',
            background: color,
            borderRadius: 2,
          }}
        />
      </div>
      <span
        style={{
          fontSize: 9,
          fontFamily: 'var(--font-mono)',
          color,
          width: 52,
          flexShrink: 0,
        }}
      >
        {label}
      </span>
    </div>
  );
}

// ── SkillCard ─────────────────────────────────────────────────────────────

function SkillCard({
  skill,
  onEdit,
  onDelete,
  onToggle,
}: {
  skill: ProjectSkill;
  onEdit: (s: ProjectSkill) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string, active: boolean) => void;
}) {
  const meta = SKILL_META[skill.skillType] ?? SKILL_META.HISTORICAL;
  const [expanded, setExpanded] = useState(false);

  let parsedContent: Record<string, unknown> = {};
  try {
    parsedContent = JSON.parse(skill.content) as Record<string, unknown>;
  } catch {}

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${skill.isActive ? meta.color : 'var(--border2)'}`,
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
        opacity: skill.isActive ? 1 : 0.55,
      }}
    >
      <div
        style={{
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 6,
            flexShrink: 0,
            background: meta.dim,
            border: `1px solid ${meta.color}33`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
          }}
        >
          {meta.icon}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                padding: '1px 6px',
                borderRadius: 100,
                background: meta.dim,
                color: meta.color,
                fontFamily: 'var(--font-mono)',
                border: `1px solid ${meta.color}33`,
              }}
            >
              {meta.label}
            </span>
            {skill.captureMethod === 'USER_RECORDED' && (
              <span style={{ fontSize: 9, color: 'var(--emerald)', fontFamily: 'var(--font-mono)' }}>
                👤 User-recorded
              </span>
            )}
            {skill.captureMethod === 'AGENT_RECORDED' && (
              <span style={{ fontSize: 9, color: 'var(--emerald)', fontFamily: 'var(--font-mono)' }}>
                🤖 Agent-recorded
              </span>
            )}
            {skill.captureMethod === 'LLM_EXTRACTED' && (
              <span style={{ fontSize: 9, color: 'var(--violet)', fontFamily: 'var(--font-mono)' }}>
                ✨ LLM-extracted
              </span>
            )}
          </div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--text)',
              marginBottom: 2,
            }}
          >
            {skill.name}
          </div>
          {skill.scope && (
            <div
              style={{
                fontSize: 10,
                color: 'var(--text-dim)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              📌 {skill.scope}
            </div>
          )}
          {skill.featureGroup && (
            <div style={{ marginTop: 3 }}>
              <span
                style={{
                  fontSize: 9,
                  padding: '1px 7px',
                  borderRadius: 100,
                  background: 'rgba(37,99,235,0.1)',
                  color: 'var(--sky)',
                  border: '1px solid rgba(37,99,235,0.2)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                ⬡ {skill.featureGroup}
              </span>
            </div>
          )}
          <div style={{ marginTop: 5 }}>
            <ConfidenceBar value={skill.confidence} />
          </div>
        </div>

        <div
          style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}
        >
          <button
            onClick={() => setExpanded((v) => !v)}
            style={{
              width: 24,
              height: 24,
              borderRadius: 4,
              border: '1px solid var(--border)',
              background: expanded ? 'var(--cyan-dim)' : 'var(--surface2)',
              color: expanded ? 'var(--cyan)' : 'var(--text-dim)',
              cursor: 'pointer',
              fontSize: 10,
            }}
          >
            {expanded ? '▲' : '▼'}
          </button>
          <button
            onClick={() => onEdit(skill)}
            style={{
              width: 24,
              height: 24,
              borderRadius: 4,
              border: '1px solid var(--border)',
              background: 'var(--surface2)',
              color: 'var(--text-dim)',
              cursor: 'pointer',
              fontSize: 11,
            }}
          >
            ✏
          </button>
          <button
            onClick={() => onToggle(skill.id, !skill.isActive)}
            title={skill.isActive ? 'Deactivate' : 'Activate'}
            style={{
              width: 24,
              height: 24,
              borderRadius: 4,
              border: '1px solid var(--border)',
              background: skill.isActive ? 'var(--emerald-dim)' : 'var(--surface2)',
              color: skill.isActive ? 'var(--emerald)' : 'var(--text-dim)',
              cursor: 'pointer',
              fontSize: 10,
            }}
          >
            {skill.isActive ? '●' : '○'}
          </button>
          <button
            onClick={() => onDelete(skill.id)}
            style={{
              width: 24,
              height: 24,
              borderRadius: 4,
              border: '1px solid rgba(220,38,38,0.2)',
              background: 'var(--rose-dim)',
              color: 'var(--rose)',
              cursor: 'pointer',
              fontSize: 10,
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {expanded && (
        <div
          style={{
            margin: '0 14px 12px',
            padding: 12,
            background: 'var(--surface2)',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--border)',
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-mid)',
            maxHeight: 300,
            overflowY: 'auto',
            lineHeight: 1.6,
          }}
        >
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {JSON.stringify(parsedContent, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── CreateSkillModal ──────────────────────────────────────────────────────

function CreateSkillModal({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [activeSkillType, setActiveSkillType] = useState<SkillType>('BUSINESS_USE_CASE');
  const [createMode, setCreateMode] = useState<'manual' | 'extract' | 'record'>('manual');
  const [name, setName] = useState('');
  const [scope, setScope] = useState('');
  const [featureGroup, setFeatureGroup] = useState('');
  const [content, setContent] = useState(SKILL_TEMPLATES['BUSINESS_USE_CASE']);
  const [targetUrl, setTargetUrl] = useState('');
  const [uploadedPath, setUploadedPath] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [activeRecording, setActiveRecording] = useState<{
    sessionId: string;
    novncPort: number;
  } | null>(null);
  // Annotation state — shown after recording stops
  const [annotationStep, setAnnotationStep] = useState<{
    skillId: string;
    skillContent: string;
  } | null>(null);
  const [annoScenarioType, setAnnoScenarioType] = useState<'Happy Path' | 'Negative' | 'Edge Case' | 'Boundary'>('Happy Path');
  const [annoNotes, setAnnoNotes] = useState('');
  const [annoVariations, setAnnoVariations] = useState('');
  const [annoRuntimeVars, setAnnoRuntimeVars] = useState<Array<{ name: string; captureFrom: string }>>([]);
  const [annoNewVarName, setAnnoNewVarName] = useState('');
  const [annoNewVarCapture, setAnnoNewVarCapture] = useState('');
  // For manual/extract creation mode (UI_FLOW only)
  const [skillRuntimeVars, setSkillRuntimeVars] = useState<Array<{ name: string; captureFrom: string }>>([]);
  const [skillNewVarName, setSkillNewVarName] = useState('');
  const [skillNewVarCapture, setSkillNewVarCapture] = useState('');

  const [manualInputMode, setManualInputMode] = useState<'plain' | 'json'>('plain');
  const [plainText, setPlainText] = useState('');

  const createMutation = useCreateSkill(projectId);
  const updateMutation = useUpdateSkill(projectId);
  const startRecordingMutation = useStartRecording(projectId);
  const stopRecordingMutation = useStopRecording(projectId);
  const cancelRecordingMutation = useCancelRecording(projectId);
  const extractMutation = useExtractSkillFromDoc(projectId);
  const convertMutation = useConvertSkillFromText(projectId);
  const uploadMutation = useUploadFile();

  const { data: envConfigs = [] } = useProjectEnvConfigs(projectId);
  const { data: featureGroupsData = [] } = useFeatureGroups(projectId);
  const { data: skillsResp } = useSkills(projectId);
  const distinctScopes = [...new Set((skillsResp?.skills ?? []).map((s) => s.scope).filter(Boolean))] as string[];

  const meta = SKILL_META[activeSkillType];

  const isDocType = !['UI_FLOW', 'HISTORICAL'].includes(activeSkillType);

  function handleAddAnnoVar() {
    if (!annoNewVarName.trim() || !annoNewVarCapture.trim()) return;
    setAnnoRuntimeVars(p => [...p, { name: annoNewVarName.trim(), captureFrom: annoNewVarCapture.trim() }]);
    setAnnoNewVarName('');
    setAnnoNewVarCapture('');
  }

  function handleAddSkillVar() {
    if (!skillNewVarName.trim() || !skillNewVarCapture.trim()) return;
    setSkillRuntimeVars(p => [...p, { name: skillNewVarName.trim(), captureFrom: skillNewVarCapture.trim() }]);
    setSkillNewVarName('');
    setSkillNewVarCapture('');
  }

  async function handleStartRecording() {
    if (!name.trim()) { toast.error('Name is required'); return; }
    if (!targetUrl.trim()) { toast.error('Target URL is required'); return; }
    try {
      const result = await startRecordingMutation.mutateAsync({
        name: name.trim(),
        targetUrl,
        scope: scope || undefined,
      });
      setActiveRecording({ sessionId: result.sessionId, novncPort: result.novncPort });
      const novncUrl = `http://${window.location.hostname}:${result.novncPort}/vnc.html?autoconnect=1&resize=scale`;
      window.open(novncUrl, '_blank');
      toast.success('Recording started — interact with the browser tab that opened');
    } catch (err) {
      toast.error((err as Error).message ?? 'Failed to start recording');
    }
  }

  async function handleStopRecording() {
    if (!activeRecording) return;
    try {
      const savedSkill = await stopRecordingMutation.mutateAsync({
        sessionId: activeRecording.sessionId,
        name: name.trim(),
        targetUrl,
        scope: scope || undefined,
        featureGroup: featureGroup || null,
      });
      toast.success('Recording saved — annotate to improve TC generation');
      setActiveRecording(null);
      setAnnotationStep({ skillId: savedSkill.id, skillContent: savedSkill.content });
    } catch (err) {
      toast.error((err as Error).message ?? 'Failed to save recording');
    }
  }

  async function handleSaveAnnotation() {
    if (!annotationStep) return;
    try {
      let updatedContent = annotationStep.skillContent;
      try {
        const parsed = JSON.parse(annotationStep.skillContent) as Record<string, unknown>;
        parsed._annotation = {
          scenarioType: annoScenarioType,
          notes: annoNotes.trim(),
          variations: annoVariations.split('\n').map((v) => v.trim()).filter(Boolean),
        };
        if (annoRuntimeVars.length > 0) {
          parsed.runtimeVariables = annoRuntimeVars;
        }
        updatedContent = JSON.stringify(parsed);
      } catch { /* keep original content if parse fails */ }

      await updateMutation.mutateAsync({
        skillId: annotationStep.skillId,
        data: {
          featureGroup: featureGroup || null,
          scope: [scope, annoScenarioType !== 'Happy Path' ? annoScenarioType : '']
            .filter(Boolean).join(' — ') || undefined,
          content: updatedContent,
        },
      });
      toast.success('Annotation saved');
    } catch { /* annotation is best-effort */ }
    onCreated();
    onClose();
  }

  async function handleSubmit() {
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }
    try {
      if (createMode === 'extract' && uploadedPath) {
        await extractMutation.mutateAsync({
          skillType: activeSkillType as 'BUSINESS_USE_CASE' | 'HLD' | 'API_CONTRACT' | 'UX_DESIGN' | 'FUNCTIONAL_RULES',
          name: name.trim(),
          filePath: uploadedPath,
          scope: scope || undefined,
          featureGroup: featureGroup || undefined,
        });
        toast.success('Skill extracted from document');
      } else if (createMode === 'manual' && manualInputMode === 'plain') {
        if (!plainText.trim()) { toast.error('Please describe the skill in the text area'); return; }
        await convertMutation.mutateAsync({
          skillType: activeSkillType,
          name: name.trim(),
          text: plainText.trim(),
          scope: scope || undefined,
          featureGroup: featureGroup || undefined,
        });
        toast.success('Skill created from description');
      } else {
        // For UI_FLOW in JSON mode, merge skillRuntimeVars into the content
        let finalContent = content;
        if (activeSkillType === 'UI_FLOW' && skillRuntimeVars.length > 0) {
          try {
            const parsed = JSON.parse(content) as Record<string, unknown>;
            parsed.runtimeVariables = skillRuntimeVars;
            finalContent = JSON.stringify(parsed, null, 2);
          } catch { /* keep original content */ }
        }
        await createMutation.mutateAsync({
          skillType: activeSkillType,
          name: name.trim(),
          scope: scope || undefined,
          featureGroup: featureGroup || null,
          content: finalContent,
        });
        toast.success('Skill created');
      }
      onCreated();
      onClose();
    } catch (err) {
      toast.error((err as Error).message ?? 'Failed to create skill');
    }
  }

  const busy =
    createMutation.isPending ||
    convertMutation.isPending ||
    startRecordingMutation.isPending ||
    stopRecordingMutation.isPending ||
    extractMutation.isPending ||
    isUploading;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 'min(700px, 95vw)',
          maxHeight: '92vh',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 20px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span style={{ fontSize: 20 }}>{annotationStep ? '📝' : meta.icon}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
              {annotationStep ? 'Annotate Recorded Skill' : 'Create Product Skill'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              {annotationStep
                ? 'Add context so the AI generates richer test cases for this flow'
                : meta.description}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-dim)',
              cursor: 'pointer',
              fontSize: 16,
            }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          {annotationStep ? (
            /* ── Annotation step ─────────────────────────────────────────── */
            <>
              <div style={{ padding: 10, background: 'var(--emerald-dim)', borderRadius: 8, border: '1px solid rgba(42,157,143,0.25)' }}>
                <div style={{ fontSize: 12, color: 'var(--emerald)', fontWeight: 700 }}>✓ Skill recorded and saved</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
                  Annotating helps the AI understand what paths to test. You can skip this step.
                </div>
              </div>

              {/* Feature Group */}
              <div>
                <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                  Feature Group
                </div>
                <input
                  className="input-field"
                  value={featureGroup}
                  onChange={(e) => setFeatureGroup(e.target.value)}
                  placeholder="e.g. Stock Creation"
                  style={{ width: '100%', boxSizing: 'border-box', fontSize: 12 }}
                />
              </div>

              {/* Scenario type */}
              <div>
                <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                  Scenario Type
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(['Happy Path', 'Negative', 'Edge Case', 'Boundary'] as const).map((st) => (
                    <button
                      key={st}
                      onClick={() => setAnnoScenarioType(st)}
                      style={{
                        padding: '5px 12px',
                        borderRadius: 6,
                        cursor: 'pointer',
                        fontSize: 11,
                        fontWeight: annoScenarioType === st ? 700 : 400,
                        border: `1px solid ${annoScenarioType === st ? 'var(--accent)' : 'var(--border)'}`,
                        background: annoScenarioType === st ? 'var(--accent-dim)' : 'var(--surface2)',
                        color: annoScenarioType === st ? 'var(--accent)' : 'var(--text-dim)',
                      }}
                    >
                      {st}
                    </button>
                  ))}
                </div>
              </div>

              {/* What this tests */}
              <div>
                <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>
                  What this flow tests (optional)
                </div>
                <textarea
                  className="input-field"
                  value={annoNotes}
                  onChange={(e) => setAnnoNotes(e.target.value)}
                  placeholder="e.g. File upload path — valid CSV with correct column headers and product codes that exist in the warehouse"
                  style={{ width: '100%', boxSizing: 'border-box', fontSize: 11, minHeight: 70, resize: 'vertical' }}
                />
              </div>

              {/* Known variations */}
              <div>
                <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>
                  Other variations the AI should also test (one per line, optional)
                </div>
                <textarea
                  className="input-field"
                  value={annoVariations}
                  onChange={(e) => setAnnoVariations(e.target.value)}
                  placeholder={"Empty file upload\nFile with wrong column headers\nFile > 50MB\nFile with duplicate serial numbers"}
                  style={{ width: '100%', boxSizing: 'border-box', fontSize: 11, minHeight: 90, resize: 'vertical', fontFamily: 'var(--font-mono)' }}
                />
              </div>

              {/* Runtime variables */}
              <div>
                <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>
                  Runtime variables — values the app generates that need to be captured &amp; reused (optional)
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 6 }}>
                  e.g. order ID, product serial number, reference code. Script generator will capture these automatically and substitute <code style={{ background: 'var(--surface2)', padding: '0 3px', borderRadius: 3, fontFamily: 'var(--font-mono)' }}>{'{{'+'varName}}'}</code> in later steps.
                </div>
                {annoRuntimeVars.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
                    {annoRuntimeVars.map((v, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 5, fontSize: 11 }}>
                        <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--cyan)', flexShrink: 0 }}>{`{{${v.name}}}`}</code>
                        <span style={{ flex: 1, color: 'var(--text-dim)' }}>from: {v.captureFrom}</span>
                        <button onClick={() => setAnnoRuntimeVars(p => p.filter((_, idx) => idx !== i))}
                          style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 13 }}>×</button>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 6 }}>
                  <input className="input-field" placeholder="varName" value={annoNewVarName}
                    onChange={(e) => setAnnoNewVarName(e.target.value.replace(/\s/g, ''))}
                    style={{ width: 110, flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: 11 }}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddAnnoVar(); }}
                  />
                  <input className="input-field" placeholder="where to capture from (e.g. order ID on confirmation screen)" value={annoNewVarCapture}
                    onChange={(e) => setAnnoNewVarCapture(e.target.value)}
                    style={{ flex: 1, fontSize: 11 }}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddAnnoVar(); }}
                  />
                  <button onClick={handleAddAnnoVar}
                    style={{ padding: '5px 10px', background: 'var(--cyan-dim)', color: 'var(--cyan)', border: '1px solid var(--border)', borderRadius: 5, cursor: 'pointer', fontSize: 11, flexShrink: 0 }}
                  >+ Add</button>
                </div>
              </div>
            </>
          ) : (
          /* ── Normal creation form ────────────────────────────────────── */
          <>
          {/* Skill type picker */}
          <div>
            <div
              style={{
                fontSize: 9,
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-dim)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                marginBottom: 6,
              }}
            >
              Skill Type
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {SKILL_TYPES.filter((t) => t !== 'HISTORICAL').map((t) => {
                const m = SKILL_META[t];
                const active = activeSkillType === t;
                return (
                  <button
                    key={t}
                    onClick={() => {
                      setActiveSkillType(t);
                      setContent(SKILL_TEMPLATES[t]);
                      setCreateMode('manual');
                    }}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 6,
                      cursor: 'pointer',
                      border: `1px solid ${active ? m.color + '66' : 'var(--border)'}`,
                      background: active ? m.dim : 'var(--surface2)',
                      color: active ? m.color : 'var(--text-dim)',
                      fontSize: 10,
                      fontWeight: active ? 700 : 400,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                    }}
                  >
                    <span>{m.icon}</span>
                    <span>{m.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Name + Scope */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div
                style={{
                  fontSize: 9,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-dim)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  marginBottom: 3,
                }}
              >
                Name *
              </div>
              <input
                className="input-field"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  activeSkillType === 'UI_FLOW'
                    ? 'e.g. New Order Form'
                    : activeSkillType === 'USER_ROLE'
                    ? 'e.g. Dealer Role'
                    : 'e.g. Feature Name'
                }
                style={{ width: '100%', boxSizing: 'border-box', fontSize: 12 }}
              />
            </div>
            <div>
              <div
                style={{
                  fontSize: 9,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-dim)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  marginBottom: 3,
                }}
              >
                Use Case
              </div>
              <ComboInput
                value={scope}
                onChange={setScope}
                options={distinctScopes}
                placeholder="e.g. Order Management"
              />
            </div>
          </div>

          {/* Feature Group */}
          <div>
            <div
              style={{
                fontSize: 9,
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-dim)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                marginBottom: 3,
              }}
            >
              Feature Group <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>(groups related skills for batch TC generation)</span>
            </div>
            <ComboInput
              value={featureGroup}
              onChange={setFeatureGroup}
              options={featureGroupsData.map((fg: { name: string }) => fg.name)}
              placeholder="e.g. Stock Creation, Purchase Order, User Management"
            />
          </div>

          {/* Capture mode for UI_FLOW */}
          {activeSkillType === 'UI_FLOW' && (
            <div>
              <div
                style={{
                  fontSize: 9,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-dim)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  marginBottom: 6,
                }}
              >
                Capture Method
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['manual', 'record', 'extract'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => { setCreateMode(mode); setActiveRecording(null); }}
                    style={{
                      flex: 1,
                      padding: '6px 10px',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontSize: 11,
                      fontWeight: 600,
                      border: `1px solid ${createMode === mode ? 'var(--emerald)' : 'var(--border)'}`,
                      background: createMode === mode ? 'var(--emerald-dim)' : 'var(--surface2)',
                      color: createMode === mode ? 'var(--emerald)' : 'var(--text-dim)',
                    }}
                  >
                    {mode === 'manual' ? '✏ Manual Entry' : mode === 'record' ? '🔴 Record my flow' : '📎 Upload File'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Doc extract option */}
          {isDocType && (
            <div>
              <div
                style={{
                  fontSize: 9,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-dim)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  marginBottom: 6,
                }}
              >
                Create From
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['manual', 'extract'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setCreateMode(mode)}
                    style={{
                      flex: 1,
                      padding: '6px 10px',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontSize: 11,
                      fontWeight: 600,
                      border: `1px solid ${createMode === mode ? meta.color : 'var(--border)'}`,
                      background: createMode === mode ? meta.dim : 'var(--surface2)',
                      color: createMode === mode ? meta.color : 'var(--text-dim)',
                    }}
                  >
                    {mode === 'manual' ? '✏ Manual Entry' : '📎 Upload File'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Record flow fields */}
          {createMode === 'record' && activeSkillType === 'UI_FLOW' && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: 12,
                background: activeRecording ? 'rgba(239,68,68,0.06)' : 'var(--emerald-dim)',
                borderRadius: 'var(--radius)',
                border: `1px solid ${activeRecording ? 'rgba(239,68,68,0.25)' : 'rgba(42,157,143,0.2)'}`,
              }}
            >
              {!activeRecording ? (
                <>
                  <div style={{ fontSize: 11, color: 'var(--emerald)' }}>
                    🔴 A browser window opens on the server — you perform the flow yourself, then click Stop & Save
                  </div>
                  {envConfigs.length > 0 && (
                    <div>
                      <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
                        Pick environment
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {envConfigs.map((env: { id: string; name: string; baseUrl: string; isDefault: boolean }) => (
                          <button
                            key={env.id}
                            type="button"
                            onClick={() => setTargetUrl(env.baseUrl)}
                            style={{
                              padding: '4px 10px',
                              fontSize: 11,
                              borderRadius: 5,
                              border: `1px solid ${targetUrl === env.baseUrl ? 'var(--emerald)' : 'var(--border2)'}`,
                              background: targetUrl === env.baseUrl ? 'var(--emerald-dim)' : 'var(--surface2)',
                              color: targetUrl === env.baseUrl ? 'var(--emerald)' : 'var(--text-dim)',
                              cursor: 'pointer',
                              fontWeight: targetUrl === env.baseUrl ? 700 : 400,
                            }}
                          >
                            {env.name}{env.isDefault ? ' ★' : ''}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <input
                    className="input-field"
                    value={targetUrl}
                    onChange={(e) => setTargetUrl(e.target.value)}
                    placeholder="Target URL (e.g. https://yourapp.com/orders/new)"
                    style={{ fontSize: 11 }}
                  />
                </>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 14 }}>🔴</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#ef4444' }}>
                      Recording in progress
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                    The browser tab should have opened. Perform your UI flow there,
                    then click <strong>Stop & Save Skill</strong> when done.
                  </div>
                  <button
                    onClick={() => {
                      const novncUrl = `http://${window.location.hostname}:${activeRecording.novncPort}/vnc.html?autoconnect=1&resize=scale`;
                      window.open(novncUrl, '_blank');
                    }}
                    style={{
                      padding: '5px 12px',
                      borderRadius: 6,
                      border: '1px solid rgba(239,68,68,0.3)',
                      background: 'rgba(239,68,68,0.08)',
                      color: '#ef4444',
                      fontSize: 11,
                      cursor: 'pointer',
                      alignSelf: 'flex-start',
                    }}
                  >
                    ↗ Re-open browser tab
                  </button>
                </>
              )}
            </div>
          )}

          {/* Doc upload */}
          {createMode === 'extract' && (
            <div
              style={{
                padding: 12,
                background: meta.dim,
                borderRadius: 'var(--radius)',
                border: `1px solid ${meta.color}33`,
              }}
            >
              <div style={{ fontSize: 11, color: meta.color, marginBottom: 8 }}>
                📎 Upload a file (.md, .xlsx, .pdf, .docx, .txt) — the AI will extract structured skill content automatically
              </div>
              {uploadedPath ? (
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--emerald)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  ✓ Document uploaded — ready to extract
                </div>
              ) : (
                <label style={{ display: 'block', cursor: 'pointer' }}>
                  <div
                    style={{
                      border: '1.5px dashed var(--border2)',
                      borderRadius: 'var(--radius)',
                      padding: 16,
                      textAlign: 'center',
                      fontSize: 12,
                      color: 'var(--text-dim)',
                    }}
                  >
                    {isUploading ? '⏳ Uploading...' : 'Drop .md / .xlsx / .pdf / .docx / .txt or click to browse'}
                  </div>
                  <input
                    type="file"
                    style={{ display: 'none' }}
                    accept=".pdf,.docx,.doc,.xlsx,.xls,.txt,.md"
                    disabled={isUploading}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setIsUploading(true);
                      try {
                        const res = await uploadMutation.mutateAsync(file);
                        setUploadedPath(res.filePath);
                        toast.success('Document uploaded');
                      } catch {
                        toast.error('Upload failed');
                      } finally {
                        setIsUploading(false);
                      }
                    }}
                  />
                </label>
              )}
            </div>
          )}

          {/* Manual entry — plain text or JSON toggle */}
          {createMode === 'manual' && (
            <div>
              {/* Mode toggle */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {manualInputMode === 'plain' ? 'Describe in plain text — AI will structure it' : 'Content (JSON)'}
                </div>
                <div style={{ display: 'flex', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: 2, gap: 2 }}>
                  {(['plain', 'json'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setManualInputMode(mode)}
                      style={{
                        padding: '3px 10px',
                        borderRadius: 4,
                        border: 'none',
                        fontSize: 10,
                        fontWeight: manualInputMode === mode ? 700 : 400,
                        background: manualInputMode === mode ? 'var(--cyan)' : 'transparent',
                        color: manualInputMode === mode ? '#fff' : 'var(--text-dim)',
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                    >
                      {mode === 'plain' ? '✏ Plain Text' : '{ } JSON'}
                    </button>
                  ))}
                </div>
              </div>

              {manualInputMode === 'plain' ? (
                <>
                  <textarea
                    className="input-field"
                    value={plainText}
                    onChange={(e) => setPlainText(e.target.value)}
                    placeholder={PLAIN_TEXT_PLACEHOLDERS[activeSkillType]}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      fontSize: 12,
                      minHeight: 220,
                      resize: 'vertical',
                      lineHeight: 1.6,
                    }}
                  />
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 6 }}>
                    Write or paste a description — the AI will convert it to structured format automatically when you save.
                  </div>
                </>
              ) : (
                <textarea
                  className="input-field"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    fontSize: 11,
                    minHeight: 220,
                    fontFamily: 'var(--font-mono)',
                    resize: 'vertical',
                  }}
                />
              )}

              {/* Runtime Variables — UI_FLOW only */}
              {activeSkillType === 'UI_FLOW' && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>
                    Runtime Variables (optional)
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 6 }}>
                    Values the app generates at runtime (order ID, serial number, reference code) that scripts must capture and reuse. Define once here — all TCs from this skill inherit the capture pattern automatically.
                  </div>
                  {skillRuntimeVars.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
                      {skillRuntimeVars.map((v, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 5, fontSize: 11 }}>
                          <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--cyan)', flexShrink: 0 }}>{`{{${v.name}}}`}</code>
                          <span style={{ flex: 1, color: 'var(--text-dim)' }}>from: {v.captureFrom}</span>
                          <button onClick={() => setSkillRuntimeVars(p => p.filter((_, idx) => idx !== i))}
                            style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 13 }}>×</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input className="input-field" placeholder="varName" value={skillNewVarName}
                      onChange={(e) => setSkillNewVarName(e.target.value.replace(/\s/g, ''))}
                      style={{ width: 110, flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: 11 }}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleAddSkillVar(); }}
                    />
                    <input className="input-field" placeholder="where to capture from (e.g. order ID on confirmation screen)" value={skillNewVarCapture}
                      onChange={(e) => setSkillNewVarCapture(e.target.value)}
                      style={{ flex: 1, fontSize: 11 }}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleAddSkillVar(); }}
                    />
                    <button onClick={handleAddSkillVar}
                      style={{ padding: '5px 10px', background: 'var(--cyan-dim)', color: 'var(--cyan)', border: '1px solid var(--border)', borderRadius: 5, cursor: 'pointer', fontSize: 11, flexShrink: 0 }}
                    >+ Add</button>
                  </div>
                </div>
              )}
            </div>
          )}
          </>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
          }}
        >
          {annotationStep ? (
            /* Annotation footer */
            <>
              <button
                onClick={() => { onCreated(); onClose(); }}
                style={{
                  padding: '8px 18px',
                  borderRadius: 'var(--radius)',
                  border: '1px solid var(--border)',
                  background: 'var(--surface2)',
                  color: 'var(--text-dim)',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Skip
              </button>
              <button
                onClick={handleSaveAnnotation}
                disabled={updateMutation.isPending}
                style={{
                  padding: '8px 22px',
                  borderRadius: 'var(--radius)',
                  border: 'none',
                  fontSize: 12,
                  fontWeight: 700,
                  background: 'linear-gradient(135deg, var(--emerald), #059669)',
                  color: '#fff',
                  cursor: updateMutation.isPending ? 'not-allowed' : 'pointer',
                  opacity: updateMutation.isPending ? 0.7 : 1,
                }}
              >
                {updateMutation.isPending ? '⏳ Saving...' : '📝 Save Annotation'}
              </button>
            </>
          ) : (
            /* Normal creation footer */
            <>
              <button
                onClick={async () => {
                  if (activeRecording) {
                    try {
                      await cancelRecordingMutation.mutateAsync(activeRecording.sessionId);
                    } catch { /* best-effort — close modal regardless */ }
                    setActiveRecording(null);
                  }
                  onClose();
                }}
                style={{
                  padding: '8px 18px',
                  borderRadius: 'var(--radius)',
                  border: '1px solid var(--border)',
                  background: 'var(--surface2)',
                  color: 'var(--text-dim)',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              {createMode === 'record' && activeSkillType === 'UI_FLOW' ? (
                activeRecording ? (
                  <button
                    onClick={handleStopRecording}
                    disabled={stopRecordingMutation.isPending}
                    style={{
                      padding: '8px 22px',
                      borderRadius: 'var(--radius)',
                      border: 'none',
                      fontSize: 12,
                      fontWeight: 700,
                      background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                      color: '#fff',
                      cursor: stopRecordingMutation.isPending ? 'not-allowed' : 'pointer',
                      opacity: stopRecordingMutation.isPending ? 0.7 : 1,
                    }}
                  >
                    {stopRecordingMutation.isPending ? '⏳ Saving...' : '⏹ Stop & Save Skill'}
                  </button>
                ) : (
                  <button
                    onClick={handleStartRecording}
                    disabled={startRecordingMutation.isPending}
                    style={{
                      padding: '8px 22px',
                      borderRadius: 'var(--radius)',
                      border: 'none',
                      fontSize: 12,
                      fontWeight: 700,
                      background: 'linear-gradient(135deg, var(--emerald), #059669)',
                      color: '#fff',
                      cursor: startRecordingMutation.isPending ? 'not-allowed' : 'pointer',
                      opacity: startRecordingMutation.isPending ? 0.7 : 1,
                    }}
                  >
                    {startRecordingMutation.isPending ? '⏳ Starting...' : '🔴 Start Recording'}
                  </button>
                )
              ) : (
                <button
                  onClick={handleSubmit}
                  disabled={busy}
                  style={{
                    padding: '8px 22px',
                    borderRadius: 'var(--radius)',
                    border: 'none',
                    fontSize: 12,
                    fontWeight: 700,
                    background: meta.color,
                    color: '#fff',
                    cursor: busy ? 'not-allowed' : 'pointer',
                    opacity: busy ? 0.7 : 1,
                  }}
                >
                  {extractMutation.isPending
                    ? '⏳ Extracting...'
                    : createMutation.isPending
                    ? '⏳ Saving...'
                    : createMode === 'extract'
                    ? '✨ Extract from Doc'
                    : '✓ Create Skill'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── EditSkillModal ────────────────────────────────────────────────────────

function EditSkillModal({
  skill,
  projectId,
  onClose,
  onSaved,
}: {
  skill: ProjectSkill;
  projectId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(skill.name);
  const [scope, setScope] = useState(skill.scope ?? '');
  const [content, setContent] = useState(() => {
    try {
      return JSON.stringify(JSON.parse(skill.content), null, 2);
    } catch {
      return skill.content;
    }
  });
  const [confidence, setConfidence] = useState(
    String(Math.round(skill.confidence * 100)),
  );

  const updateMutation = useUpdateSkill(projectId);
  const meta = SKILL_META[skill.skillType] ?? SKILL_META.HISTORICAL;

  async function handleSave() {
    try {
      JSON.parse(content);
    } catch {
      toast.error('Content must be valid JSON');
      return;
    }
    try {
      await updateMutation.mutateAsync({
        skillId: skill.id,
        data: {
          name,
          scope: scope || undefined,
          content,
          confidence: Number(confidence) / 100,
        },
      });
      toast.success('Skill updated');
      onSaved();
    } catch {
      toast.error('Update failed');
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 'min(620px, 95vw)',
          maxHeight: '88vh',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            padding: '14px 18px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ fontSize: 16 }}>{meta.icon}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', flex: 1 }}>
            Edit — {skill.name}
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-dim)',
              cursor: 'pointer',
              fontSize: 15,
            }}
          >
            ✕
          </button>
        </div>
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '14px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div
                style={{
                  fontSize: 9,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-dim)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  marginBottom: 3,
                }}
              >
                Name
              </div>
              <input
                className="input-field"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', fontSize: 12 }}
              />
            </div>
            <div>
              <div
                style={{
                  fontSize: 9,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-dim)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  marginBottom: 3,
                }}
              >
                Scope
              </div>
              <input
                className="input-field"
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', fontSize: 12 }}
              />
            </div>
          </div>
          <div>
            <div
              style={{
                fontSize: 9,
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-dim)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                marginBottom: 3,
              }}
            >
              Confidence ({confidence}%)
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={confidence}
              onChange={(e) => setConfidence(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <div
              style={{
                fontSize: 9,
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-dim)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                marginBottom: 3,
              }}
            >
              Content — JSON or plain text
            </div>
            <textarea
              className="input-field"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                fontSize: 11,
                minHeight: 260,
                fontFamily: 'var(--font-mono)',
                resize: 'vertical',
              }}
            />
          </div>
        </div>
        <div
          style={{
            padding: '12px 18px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: '7px 16px',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              background: 'var(--surface2)',
              color: 'var(--text-dim)',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            style={{
              padding: '7px 20px',
              borderRadius: 'var(--radius)',
              border: 'none',
              background: meta.color,
              color: '#fff',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {updateMutation.isPending ? '⏳ Saving...' : '✓ Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── FeatureGenerateModal ──────────────────────────────────────────────────

type TCProgressEvent =
  | { event: 'progress'; data: { step: number; total: number; skillName: string; skillType: string; status: string } }
  | { event: 'skill_result'; data: { testCases: GeneratedTC[]; skillName: string; step: number; cumulativeCount: number } }
  | { event: 'result'; data: { testCases: GeneratedTC[] } }
  | { event: 'done'; data: { totalGenerated: number } }
  | { event: 'error'; data: { message: string } };

interface GeneratedTC {
  title: string;
  description?: string;
  steps?: string[];
  expectedResult?: string;
  type?: string;
  priority?: string;
  tags?: string[];
  [key: string]: unknown;
}

function FeatureGenerateModal({
  projectId,
  projectSlug,
  featureGroup,
  skillCount,
  onClose,
}: {
  projectId: string;
  projectSlug: string;
  featureGroup: string;
  skillCount: number;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const saveTCsMutation = useSaveTestCases(projectId);

  const [phase, setPhase] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState<{ step: number; total: number; skillName: string; skillType: string } | null>(null);
  const [allTCs, setAllTCs] = useState<GeneratedTC[]>([]);
  const [errMsg, setErrMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const pct = progress ? Math.round((progress.step / progress.total) * 100) : 0;

  async function startGeneration() {
    setPhase('running');
    setAllTCs([]);
    setErrMsg('');
    setProgress(null);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const token = await getToken();
      const res = await fetch(
        `/api/projects/${projectSlug}/skills/generate-feature-tcs`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ featureGroup }),
          signal: abort.signal,
        },
      );

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => 'Unknown error');
        setErrMsg(text);
        setPhase('error');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      const accTCs: GeneratedTC[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        const msgs = buf.split('\n\n');
        buf = msgs.pop() ?? '';

        for (const msg of msgs) {
          if (!msg.trim()) continue;
          const eventLine = msg.match(/^event: (.+)/m)?.[1]?.trim();
          const dataLine = msg.match(/^data: (.+)/m)?.[1]?.trim();
          if (!eventLine || !dataLine) continue;

          try {
            const payload = JSON.parse(dataLine) as Record<string, unknown>;
            const ev = { event: eventLine, data: payload } as TCProgressEvent;

            if (ev.event === 'progress') {
              setProgress({
                step: ev.data.step,
                total: ev.data.total,
                skillName: ev.data.skillName,
                skillType: ev.data.skillType,
              });
            } else if (ev.event === 'skill_result') {
              // TCs from a single completed skill — shown immediately
              accTCs.push(...((ev.data as { testCases: GeneratedTC[] }).testCases));
              setAllTCs([...accTCs]);
            } else if (ev.event === 'result') {
              // Final consolidated list — replace to deduplicate
              setAllTCs(ev.data.testCases as GeneratedTC[]);
            } else if (ev.event === 'done') {
              setPhase('done');
            } else if (ev.event === 'error') {
              setErrMsg((ev.data as { message: string }).message);
              setPhase('error');
            }
          } catch { /* skip malformed SSE message */ }
        }
      }

      if (phase !== 'done') setPhase('done');
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setErrMsg((err as Error).message ?? 'Stream failed');
      setPhase('error');
    }
  }

  async function handleSave() {
    if (allTCs.length === 0) return;
    setSaving(true);
    try {
      await saveTCsMutation.mutateAsync(
        allTCs.map((tc) => ({
          title: String(tc.title ?? 'Untitled'),
          description: tc.description ? String(tc.description) : undefined,
          steps: Array.isArray(tc.steps) ? (tc.steps as string[]) : [],
          expectedResult: tc.expectedResult ? String(tc.expectedResult) : undefined,
          type: (['UI', 'API', 'SIT'].includes(String(tc.type)) ? tc.type : 'UI') as 'UI' | 'API' | 'SIT',
          priority: (['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(String(tc.priority)) ? tc.priority : 'MEDIUM') as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
          status: 'DRAFT' as const,
          tags: Array.isArray(tc.tags) ? [...(tc.tags as string[]), featureGroup] : [featureGroup],
          useCaseTag: featureGroup,
        })),
      );
      toast.success(`${allTCs.length} test cases saved`);
      qc.invalidateQueries({ queryKey: ['test-cases', projectId] });
      onClose();
    } catch {
      toast.error('Failed to save test cases');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1100,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && phase !== 'running') onClose();
      }}
    >
      <div
        style={{
          width: 'min(620px, 95vw)',
          maxHeight: '88vh',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 20px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span style={{ fontSize: 18 }}>⬡</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
              Generate TCs — {featureGroup}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              {skillCount} skill{skillCount !== 1 ? 's' : ''} · processed one by one to minimise tokens
            </div>
          </div>
          {phase !== 'running' && (
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 16 }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {phase === 'idle' && (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>⬡</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>
                Ready to generate test cases
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.65, maxWidth: 420, margin: '0 auto 20px' }}>
                Each skill in <strong>{featureGroup}</strong> will be processed in sequence.
                The AI will generate unique test cases per skill, skipping duplicates.
              </div>
              <button
                onClick={() => void startGeneration()}
                style={{
                  padding: '10px 28px',
                  borderRadius: 8,
                  border: 'none',
                  background: 'linear-gradient(135deg, var(--sky), #2563eb)',
                  color: '#fff',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                ▶ Start Generation
              </button>
            </div>
          )}

          {(phase === 'running' || phase === 'done') && progress && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                  {phase === 'done' ? '✓ Done' : `Processing skill ${progress.step} of ${progress.total}`}
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                  {phase === 'done' ? '100' : pct}%
                </span>
              </div>
              {/* Progress bar */}
              <div style={{ height: 8, background: 'var(--surface3)', borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
                <div
                  style={{
                    height: '100%',
                    width: `${phase === 'done' ? 100 : pct}%`,
                    background: phase === 'done'
                      ? 'linear-gradient(90deg, var(--emerald), #059669)'
                      : 'linear-gradient(90deg, var(--sky), #2563eb)',
                    borderRadius: 4,
                    transition: 'width 0.4s ease',
                  }}
                />
              </div>
              {phase === 'running' && (
                <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                  ⏳ {progress.skillName} [{progress.skillType}]
                </div>
              )}
            </div>
          )}

          {phase === 'error' && (
            <div style={{ padding: 12, background: 'var(--rose-dim)', borderRadius: 8, border: '1px solid rgba(220,38,38,0.2)' }}>
              <div style={{ fontSize: 12, color: 'var(--rose)', fontWeight: 700, marginBottom: 4 }}>Generation failed</div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{errMsg}</div>
            </div>
          )}

          {allTCs.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
                {allTCs.length} test case{allTCs.length !== 1 ? 's' : ''} generated
                {phase === 'running' ? ' so far…' : ''}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 340, overflowY: 'auto' }}>
                {allTCs.map((tc, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '8px 12px',
                      background: 'var(--surface2)',
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>
                      {tc.title}
                    </div>
                    {tc.description && (
                      <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                        {tc.description}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 5, marginTop: 5 }}>
                      {tc.type && (
                        <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 100, background: 'var(--cyan-dim)', color: 'var(--cyan)', fontFamily: 'var(--font-mono)' }}>
                          {String(tc.type)}
                        </span>
                      )}
                      {tc.priority && (
                        <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 100, background: 'var(--surface3)', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                          {String(tc.priority)}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={() => {
              abortRef.current?.abort();
              onClose();
            }}
            disabled={saving}
            style={{
              padding: '8px 18px',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              background: 'var(--surface2)',
              color: 'var(--text-dim)',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            {phase === 'running' ? 'Cancel' : 'Close'}
          </button>
          {phase === 'done' && allTCs.length > 0 && (
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              style={{
                padding: '8px 22px',
                borderRadius: 'var(--radius)',
                border: 'none',
                fontSize: 12,
                fontWeight: 700,
                background: 'linear-gradient(135deg, var(--emerald), #059669)',
                color: '#fff',
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? '⏳ Saving...' : `✓ Save ${allTCs.length} Test Cases`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Skills page ──────────────────────────────────────────────────────

export default function Skills() {
  const { slug } = useParams<{ slug: string }>();
  const { data: project } = useProject(slug);
  const projectId = project?.id;

  const [filterType, setFilterType] = useState<SkillType | 'ALL'>('ALL');
  const [showCreate, setShowCreate] = useState(false);
  const [editingSkill, setEditingSkill] = useState<ProjectSkill | null>(null);
  const [generateFeature, setGenerateFeature] = useState<{ name: string; skillCount: number } | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const {
    data: skillsData,
    refetch,
    isLoading,
  } = useSkills(projectId, filterType !== 'ALL' ? filterType : undefined);

  const { data: featureGroups } = useFeatureGroups(projectId);

  const updateMutation = useUpdateSkill(projectId ?? '');
  const deleteMutation = useDeleteSkill(projectId ?? '');

  const skills = skillsData?.skills ?? [];

  const skillsByType = SKILL_TYPES.reduce(
    (acc, t) => {
      acc[t] = skills.filter((s) => s.skillType === t);
      return acc;
    },
    {} as Record<SkillType, ProjectSkill[]>,
  );

  async function handleToggle(skillId: string, isActive: boolean) {
    try {
      await updateMutation.mutateAsync({ skillId, data: { isActive } });
      toast.success(isActive ? 'Skill activated' : 'Skill deactivated');
    } catch {
      toast.error('Update failed');
    }
  }

  async function handleDelete(skillId: string) {
    if (!window.confirm('Delete this skill? This cannot be undone.')) return;
    try {
      await deleteMutation.mutateAsync(skillId);
      toast.success('Skill deleted');
    } catch {
      toast.error('Delete failed');
    }
  }

  const totalActive = skills.filter((s) => s.isActive).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <Topbar
        breadcrumbs={[
          { label: 'All Projects', href: '/projects' },
          {
            label: `📡 ${project?.name ?? slug ?? ''}`,
            href: `/projects/${slug}/settings`,
          },
          { label: '🧠 Product Skills' },
        ]}
        actions={
          <>
            <TbBtn variant="primary" onClick={() => setShowCreate(true)}>
              + Add Skill
            </TbBtn>
          </>
        }
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 80px' }}>
        {/* Stats row */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4,1fr)',
            gap: 10,
            marginBottom: 16,
          }}
        >
          {[
            { label: 'Total Skills', value: skills.length, color: 'var(--cyan)' },
            { label: 'Active', value: totalActive, color: 'var(--emerald)' },
            { label: 'UI Flows', value: skillsByType.UI_FLOW.length, color: 'var(--emerald)' },
            {
              label: 'Use Cases',
              value: skillsByType.BUSINESS_USE_CASE.length,
              color: 'var(--violet)',
            },
          ].map((s) => (
            <div key={s.label} className="stat-card sc-cyan" style={{ padding: '10px 14px' }}>
              <div className="stat-label">{s.label}</div>
              <div className="stat-value" style={{ color: s.color, fontSize: 20 }}>
                {s.value}
              </div>
            </div>
          ))}
        </div>

        {/* Feature Groups section */}
        {featureGroups && featureGroups.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>⬡</span>
              <span>Feature Groups</span>
              <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontWeight: 400 }}>
                · generate all test cases for a feature in one click
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {featureGroups.map((fg) => {
                const collapsed = collapsedGroups.has(fg.name);
                const groupSkills = skills.filter((s) => s.featureGroup === fg.name);
                return (
                  <div
                    key={fg.name}
                    style={{
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      overflow: 'hidden',
                      minWidth: 220,
                      flex: '1 1 220px',
                      maxWidth: 340,
                    }}
                  >
                    <div
                      style={{
                        padding: '10px 14px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        borderBottom: collapsed ? 'none' : '1px solid var(--border)',
                        cursor: 'pointer',
                        background: 'rgba(37,99,235,0.04)',
                      }}
                      onClick={() => {
                        setCollapsedGroups((prev) => {
                          const next = new Set(prev);
                          if (next.has(fg.name)) next.delete(fg.name);
                          else next.add(fg.name);
                          return next;
                        });
                      }}
                    >
                      <span style={{ fontSize: 16 }}>⬡</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--sky)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {fg.name}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                          {fg.skillCount} skill{fg.skillCount !== 1 ? 's' : ''} · {fg.activeCount} active
                        </div>
                      </div>
                      <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>{collapsed ? '▶' : '▼'}</span>
                    </div>
                    {!collapsed && (
                      <div style={{ padding: '8px 14px 10px' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                          {fg.skillTypes.map((st) => {
                            const m = SKILL_META[st as SkillType] ?? SKILL_META.HISTORICAL;
                            return (
                              <span
                                key={st}
                                style={{
                                  fontSize: 9,
                                  padding: '1px 6px',
                                  borderRadius: 100,
                                  background: m.dim,
                                  color: m.color,
                                  border: `1px solid ${m.color}33`,
                                  fontFamily: 'var(--font-mono)',
                                }}
                              >
                                {m.icon} {m.label}
                              </span>
                            );
                          })}
                        </div>
                        {groupSkills.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                            {groupSkills.map((s) => (
                              <div key={s.id} style={{ fontSize: 10, color: 'var(--text-mid)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span style={{ color: s.isActive ? 'var(--emerald)' : 'var(--border2)', fontSize: 8 }}>●</span>
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <button
                          onClick={() => setGenerateFeature({ name: fg.name, skillCount: fg.skillCount })}
                          style={{
                            width: '100%',
                            padding: '6px 0',
                            borderRadius: 6,
                            border: '1px solid rgba(37,99,235,0.3)',
                            background: 'rgba(37,99,235,0.08)',
                            color: 'var(--sky)',
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          ✨ Generate TCs for this feature
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && skills.length === 0 && (
          <div
            style={{
              padding: '36px 24px',
              background: 'var(--surface2)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              textAlign: 'center',
              marginBottom: 16,
            }}
          >
            <div style={{ fontSize: 40, marginBottom: 10, opacity: 0.4 }}>🧠</div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: 'var(--text)',
                marginBottom: 6,
              }}
            >
              Teach the tool about your product
            </div>
            <div
              style={{
                fontSize: 12,
                color: 'var(--text-dim)',
                maxWidth: 500,
                margin: '0 auto 18px',
                lineHeight: 1.65,
              }}
            >
              Skills are reusable knowledge packages — UI flows with real selectors, business rules,
              test data, API contracts, and user roles. The more skills you add, the more accurate and
              grounded your test case generation becomes.
            </div>
            <button
              onClick={() => setShowCreate(true)}
              style={{
                padding: '9px 24px',
                background: 'linear-gradient(135deg, var(--cyan), var(--sky))',
                border: 'none',
                borderRadius: 8,
                color: '#fff',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              + Add First Skill
            </button>
          </div>
        )}

        {/* Filter tabs */}
        {skills.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 14 }}>
            <button
              onClick={() => setFilterType('ALL')}
              style={{
                padding: '4px 12px',
                borderRadius: 6,
                border: `1px solid ${filterType === 'ALL' ? 'var(--cyan)' : 'var(--border)'}`,
                background: filterType === 'ALL' ? 'var(--cyan-dim)' : 'var(--surface2)',
                color: filterType === 'ALL' ? 'var(--cyan)' : 'var(--text-dim)',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              All ({skills.length})
            </button>
            {SKILL_TYPES.filter(
              (t) => t !== 'HISTORICAL' || skillsByType.HISTORICAL.length > 0,
            ).map((t) => {
              const m = SKILL_META[t];
              const count = skillsByType[t].length;
              if (count === 0) return null;
              const active = filterType === t;
              return (
                <button
                  key={t}
                  onClick={() => setFilterType(t)}
                  style={{
                    padding: '4px 12px',
                    borderRadius: 6,
                    border: `1px solid ${active ? m.color + '66' : 'var(--border)'}`,
                    background: active ? m.dim : 'var(--surface2)',
                    color: active ? m.color : 'var(--text-dim)',
                    fontSize: 11,
                    fontWeight: active ? 700 : 400,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <span>{m.icon}</span>
                  <span>{m.label}</span>
                  <span
                    style={{
                      background: 'var(--surface3)',
                      borderRadius: 8,
                      padding: '0 5px',
                      fontSize: 9,
                    }}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Skills list — grouped when showing all */}
        {filterType === 'ALL'
          ? SKILL_TYPES.filter((t) => skillsByType[t].length > 0).map((t) => (
              <div key={t} style={{ marginBottom: 18 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  <span style={{ fontSize: 14 }}>{SKILL_META[t].icon}</span>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: SKILL_META[t].color,
                    }}
                  >
                    {SKILL_META[t].label}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      color: 'var(--text-dim)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {skillsByType[t].length} skill
                    {skillsByType[t].length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {skillsByType[t].map((skill) => (
                    <SkillCard
                      key={skill.id}
                      skill={skill}
                      onEdit={setEditingSkill}
                      onDelete={handleDelete}
                      onToggle={handleToggle}
                    />
                  ))}
                </div>
              </div>
            ))
          : skills.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                onEdit={setEditingSkill}
                onDelete={handleDelete}
                onToggle={handleToggle}
              />
            ))}
      </div>

      {showCreate && projectId && (
        <CreateSkillModal
          projectId={projectId}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            void refetch();
          }}
        />
      )}

      {editingSkill && projectId && (
        <EditSkillModal
          skill={editingSkill}
          projectId={projectId}
          onClose={() => setEditingSkill(null)}
          onSaved={() => {
            void refetch();
            setEditingSkill(null);
          }}
        />
      )}

      {generateFeature && projectId && slug && (
        <FeatureGenerateModal
          projectId={projectId}
          projectSlug={slug}
          featureGroup={generateFeature.name}
          skillCount={generateFeature.skillCount}
          onClose={() => setGenerateFeature(null)}
        />
      )}
    </div>
  );
}
