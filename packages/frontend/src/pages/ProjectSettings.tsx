import React, { useState, useEffect } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import * as Dialog from '@radix-ui/react-dialog';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import Topbar, { TbBtn } from '../components/layout/Topbar';
import {
  useProjectEnvConfigs,
  useProjectMembers,
  useRequirementDocs,
  useUpdateProject,
  useDeleteProject,
} from '../hooks/useProjects';
import { useProjectStore } from '../stores/projectStore';
import { PROJECT_GRADIENTS, getInitials } from '../lib/utils';

const LABEL_STYLE: React.CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-mono)',
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '1.2px',
  textTransform: 'uppercase' as const,
  color: 'var(--text-mid)',
  marginBottom: '6px',
};

// ── Tab indicator shared style ─────────────────────────────────────────────
const TAB_TRIGGER_STYLE = (active: boolean): React.CSSProperties => ({
  padding: '10px 18px',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
  border: 'none',
  background: 'transparent',
  color: active ? 'var(--6d-orange)' : 'var(--text-mid)',
  borderBottom: active ? '2px solid var(--6d-orange)' : '2px solid transparent',
  transition: 'all 0.15s',
  fontFamily: 'var(--font-ui)',
  whiteSpace: 'nowrap' as const,
});

// ── Details tab ────────────────────────────────────────────────────────────
function DetailsTab() {
  const { activeProject } = useProjectStore();
  const { slug } = useParams<{ slug: string }>();
  const updateProject = useUpdateProject(activeProject?.id ?? '');
  const [name, setName]       = useState(activeProject?.name ?? '');
  const [desc, setDesc]       = useState(activeProject?.description ?? '');
  const [baseUrl, setBaseUrl] = useState(activeProject?.baseUrl ?? '');
  const [colorIdx, setColorIdx] = useState(0);

  useEffect(() => {
    if (activeProject) {
      setName(activeProject.name);
      setDesc(activeProject.description ?? '');
      setBaseUrl(activeProject.baseUrl ?? '');
    }
  }, [activeProject]);

  async function handleSave() {
    if (!activeProject) return;
    try {
      await updateProject.mutateAsync({ name, description: desc, baseUrl });
      toast.success('Project details saved.');
    } catch {
      toast.error('Failed to save project details.');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '560px' }}>
      <div>
        <label style={LABEL_STYLE}>Project Name</label>
        <input
          className="input-field"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ fontFamily: 'var(--font-ui)', fontSize: '14px', fontWeight: 600 }}
        />
      </div>

      <div>
        <label style={LABEL_STYLE}>
          Slug{' '}
          <span style={{ color: 'var(--text-dim)', fontSize: '9px', fontWeight: 400, letterSpacing: 0 }}>
            (readonly after creation)
          </span>
        </label>
        <input
          className="input-field"
          value={slug ?? ''}
          readOnly
          style={{ color: 'var(--cyan)', cursor: 'not-allowed', opacity: 0.8 }}
        />
      </div>

      <div>
        <label style={LABEL_STYLE}>Description</label>
        <textarea
          className="input-field"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          style={{ minHeight: '80px', fontFamily: 'var(--font-ui)', fontSize: '13px' }}
        />
      </div>

      <div>
        <label style={LABEL_STYLE}>Base URL</label>
        <input
          className="input-field"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://app.example.com"
          style={{ fontFamily: 'var(--font-mono)' }}
        />
      </div>

      <div>
        <label style={LABEL_STYLE}>Project Color</label>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '9px',
              background: PROJECT_GRADIENTS[colorIdx],
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '16px',
              color: '#fff',
              fontWeight: 800,
              cursor: 'pointer',
              border: '2px solid rgba(37,99,171,0.3)',
            }}
          >
            {getInitials(name || 'P')}
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            {PROJECT_GRADIENTS.map((g, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setColorIdx(i)}
                style={{
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  background: g,
                  border: colorIdx === i ? '2px solid var(--cyan)' : '2px solid transparent',
                  cursor: 'pointer',
                  transition: 'border 0.15s',
                }}
              />
            ))}
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)' }}>
            Pick color
          </span>
        </div>
      </div>

      <div>
        <button
          type="button"
          onClick={handleSave}
          disabled={updateProject.isPending}
          style={{
            padding: '9px 20px',
            background: 'linear-gradient(135deg, #F47B20, #D9601A)',
            border: 'none',
            borderRadius: '6px',
            color: '#fff',
            fontSize: '13px',
            fontWeight: 700,
            cursor: 'pointer',
            fontFamily: 'var(--font-ui)',
            opacity: updateProject.isPending ? 0.6 : 1,
          }}
        >
          {updateProject.isPending ? 'Saving…' : '💾 Save Changes'}
        </button>
      </div>
    </div>
  );
}

// ── Environments tab ───────────────────────────────────────────────────────
function EnvironmentsTab() {
  const { activeProject } = useProjectStore();
  const { data: envs = [] } = useProjectEnvConfigs(activeProject?.id);
  const [newName, setNewName]   = useState('');
  const [newUrl, setNewUrl]     = useState('');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className="card">
        <div className="card-header">
          <div className="card-title">Environments</div>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Base URL</th>
              <th>Default</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {envs.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  style={{
                    textAlign: 'center',
                    padding: '24px',
                    color: 'var(--text-dim)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11px',
                  }}
                >
                  No environments configured yet.
                </td>
              </tr>
            ) : (
              envs.map((env) => (
                <tr key={env.id}>
                  <td className="primary">
                    <span
                      className={`badge badge-${env.name.toLowerCase() === 'qa' ? 'cyan' : env.name.toLowerCase() === 'staging' ? 'skip' : 'draft'}`}
                    >
                      {env.name}
                    </span>
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{env.baseUrl}</td>
                  <td>
                    {env.isDefault && (
                      <span className="badge badge-pass">Default</span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button className="tb-btn tb-btn-ghost" style={{ padding: '4px 10px', fontSize: '11px' }}>
                        Edit
                      </button>
                      <button
                        className="tb-btn tb-btn-ghost"
                        style={{ padding: '4px 10px', fontSize: '11px', color: 'var(--rose)', borderColor: 'rgba(220,38,38,0.3)' }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add environment form */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Add Environment</div>
        </div>
        <div className="card-body" style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
          <div style={{ flex: '0 0 140px' }}>
            <label style={LABEL_STYLE}>Name</label>
            <input
              className="input-field"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="QA / Staging / Dev"
              style={{ fontFamily: 'var(--font-ui)' }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={LABEL_STYLE}>Base URL</label>
            <input
              className="input-field"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://qa.example.com"
              style={{ fontFamily: 'var(--font-mono)' }}
            />
          </div>
          <button
            type="button"
            style={{
              padding: '8px 16px',
              background: 'var(--cyan)',
              border: 'none',
              borderRadius: '6px',
              color: '#fff',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'var(--font-ui)',
              flexShrink: 0,
            }}
          >
            + Add
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Members tab ────────────────────────────────────────────────────────────
function MembersTab() {
  const { activeProject } = useProjectStore();
  const { data: members = [] } = useProjectMembers(activeProject?.id);
  const [inviteEmail, setInviteEmail] = useState('');

  const ROLE_COLORS: Record<string, string> = {
    ADMIN: 'badge-cyan',
    QA_ENGINEER: 'badge-pass',
    VIEWER: 'badge-draft',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className="card">
        <div className="card-header">
          <div className="card-title">Project Members</div>
          <span className="badge badge-draft">{members.length} members</span>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Email</th>
              <th>Role</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {members.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  style={{
                    textAlign: 'center',
                    padding: '24px',
                    color: 'var(--text-dim)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11px',
                  }}
                >
                  No members yet. Invite your team below.
                </td>
              </tr>
            ) : (
              members.map((m) => (
                <tr key={`${m.projectId}-${m.userId}`}>
                  <td className="primary">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div
                        style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '50%',
                          background: 'linear-gradient(135deg, var(--violet), var(--cyan))',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '10px',
                          fontWeight: 700,
                          color: '#fff',
                          flexShrink: 0,
                        }}
                      >
                        {getInitials(m.user.name)}
                      </div>
                      {m.user.name}
                    </div>
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{m.user.email}</td>
                  <td>
                    <span className={`badge ${ROLE_COLORS[m.role] ?? 'badge-draft'}`}>{m.role}</span>
                  </td>
                  <td>
                    <button
                      className="tb-btn tb-btn-ghost"
                      style={{ padding: '4px 10px', fontSize: '11px', color: 'var(--rose)', borderColor: 'rgba(220,38,38,0.3)' }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Invite form */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Invite by Email</div>
        </div>
        <div className="card-body" style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label style={LABEL_STYLE}>Email Address</label>
            <input
              className="input-field"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="colleague@company.com"
              type="email"
              style={{ fontFamily: 'var(--font-ui)' }}
            />
          </div>
          <button
            type="button"
            style={{
              padding: '8px 16px',
              background: 'var(--cyan)',
              border: 'none',
              borderRadius: '6px',
              color: '#fff',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'var(--font-ui)',
              flexShrink: 0,
            }}
          >
            Send Invite
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Req Library tab ────────────────────────────────────────────────────────
function ReqLibraryTab() {
  const { activeProject } = useProjectStore();
  const { data: docs = [] } = useRequirementDocs(activeProject?.id);
  const [folderPath, setFolderPath] = useState(activeProject?.reqLibraryPath ?? '');

  const TYPE_BADGE: Record<string, string> = {
    pdf: 'badge-fail',
    xlsx: 'badge-pass',
    docx: 'badge-cyan',
    md: 'badge-draft',
    txt: 'badge-draft',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Info banner */}
      <div
        style={{
          padding: '12px 16px',
          background: 'var(--violet-dim)',
          border: '1px solid rgba(244,123,32,0.2)',
          borderRadius: 'var(--radius)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}
      >
        <span style={{ fontSize: '18px' }}>📁</span>
        <p style={{ fontSize: '12px', color: 'var(--text-mid)', lineHeight: 1.55 }}>
          <strong style={{ color: 'var(--violet)' }}>Auto-loaded by Writer Agent on every run.</strong>
          {' '}All active documents in this library are injected as background context whenever test cases are generated — you never need to re-upload the same document twice.
        </p>
      </div>

      {/* Source path */}
      <div className="card">
        <div className="card-header">
          <div className="card-title" style={{ color: 'var(--violet)' }}>📁 Source Path</div>
        </div>
        <div className="card-body">
          <label style={LABEL_STYLE}>Requirement Documents Folder Path</label>
          <input
            className="input-field"
            value={folderPath}
            onChange={(e) => setFolderPath(e.target.value)}
            placeholder="/requirements/airtel-ventas"
            style={{ fontFamily: 'var(--font-mono)' }}
          />
          <p style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
            Absolute path inside the qa-reqdocs volume where HLD, BRD, PRD, and API spec files are stored.
          </p>
        </div>
      </div>

      {/* Documents list */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Active Documents</div>
          <button
            type="button"
            className="tb-btn tb-btn-ghost"
            style={{ fontSize: '11px', padding: '4px 10px' }}
          >
            + Upload
          </button>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Filename</th>
              <th>Type</th>
              <th>Active</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {docs.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  style={{
                    textAlign: 'center',
                    padding: '24px',
                    color: 'var(--text-dim)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11px',
                  }}
                >
                  No requirement documents yet. Upload your HLD, BRD, PRD, or API specs.
                </td>
              </tr>
            ) : (
              docs.map((doc) => {
                const ext = doc.filename.split('.').pop()?.toLowerCase() ?? 'txt';
                return (
                  <tr key={doc.id}>
                    <td className="primary" style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                      {doc.filename}
                    </td>
                    <td>
                      <span className={`badge ${TYPE_BADGE[ext] ?? 'badge-draft'}`}>{ext.toUpperCase()}</span>
                    </td>
                    <td>
                      <div
                        style={{
                          width: '36px',
                          height: '20px',
                          borderRadius: '100px',
                          background: doc.isActive ? 'var(--pass)' : 'var(--surface3)',
                          cursor: 'pointer',
                          transition: 'background 0.2s',
                          position: 'relative',
                        }}
                      >
                        <div
                          style={{
                            position: 'absolute',
                            top: '3px',
                            left: doc.isActive ? '18px' : '3px',
                            width: '14px',
                            height: '14px',
                            borderRadius: '50%',
                            background: '#fff',
                            transition: 'left 0.2s',
                          }}
                        />
                      </div>
                    </td>
                    <td>
                      <button
                        className="tb-btn tb-btn-ghost"
                        style={{ padding: '4px 10px', fontSize: '11px', color: 'var(--rose)', borderColor: 'rgba(220,38,38,0.3)' }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Danger zone tab ────────────────────────────────────────────────────────
function DangerZoneTab() {
  const { activeProject } = useProjectStore();
  const navigate = useNavigate();
  const deleteProject = useDeleteProject(activeProject?.id ?? '');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');

  async function handleDelete() {
    if (confirmName !== activeProject?.name) {
      toast.error('Project name does not match.');
      return;
    }
    try {
      await deleteProject.mutateAsync();
      toast.success('Project deleted.');
      navigate('/projects', { replace: true });
    } catch {
      toast.error('Failed to delete project.');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '560px' }}>
      {/* Archive */}
      <div
        style={{
          padding: '20px',
          border: '1px solid rgba(244,123,32,0.3)',
          borderRadius: 'var(--radius-lg)',
          background: 'rgba(244,123,32,0.03)',
        }}
      >
        <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--amber)', marginBottom: '6px' }}>
          Archive Project
        </h3>
        <p style={{ fontSize: '12px', color: 'var(--text-mid)', marginBottom: '14px', lineHeight: 1.55 }}>
          Archiving makes this project read-only. All test cases, scripts, and run history are preserved. You can unarchive at any time.
        </p>
        <button
          type="button"
          style={{
            padding: '8px 18px',
            border: '1px solid rgba(244,123,32,0.4)',
            borderRadius: '6px',
            background: 'transparent',
            color: 'var(--amber)',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'var(--font-ui)',
          }}
        >
          Archive Project
        </button>
      </div>

      {/* Delete */}
      <div
        style={{
          padding: '20px',
          border: '1px solid rgba(220,38,38,0.3)',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--rose-dim)',
        }}
      >
        <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--rose)', marginBottom: '6px' }}>
          Delete Project
        </h3>
        <p style={{ fontSize: '12px', color: 'var(--text-mid)', marginBottom: '14px', lineHeight: 1.55 }}>
          Permanently deletes the project and all associated test cases, scripts, run history, and files.{' '}
          <strong style={{ color: 'var(--rose)' }}>This cannot be undone.</strong>
        </p>
        <button
          type="button"
          onClick={() => setDeleteOpen(true)}
          style={{
            padding: '8px 18px',
            border: '1px solid rgba(220,38,38,0.4)',
            borderRadius: '6px',
            background: 'transparent',
            color: 'var(--rose)',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'var(--font-ui)',
          }}
        >
          🗑 Delete Project
        </button>
      </div>

      {/* Confirm delete dialog */}
      <Dialog.Root open={deleteOpen} onOpenChange={setDeleteOpen}>
        <Dialog.Portal>
          <Dialog.Overlay
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(6,34,74,0.6)',
              backdropFilter: 'blur(4px)',
              zIndex: 9998,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Dialog.Content
              style={{
                background: 'var(--surface)',
                border: '1px solid rgba(220,38,38,0.3)',
                borderRadius: 'var(--radius-lg)',
                padding: '28px',
                width: '440px',
                maxWidth: '96vw',
                zIndex: 9999,
                fontFamily: 'var(--font-ui)',
              }}
            >
              <Dialog.Title
                style={{ fontSize: '16px', fontWeight: 800, color: 'var(--rose)', marginBottom: '8px' }}
              >
                Delete "{activeProject?.name}"?
              </Dialog.Title>
              <Dialog.Description
                style={{ fontSize: '13px', color: 'var(--text-mid)', marginBottom: '20px', lineHeight: 1.55 }}
              >
                This will permanently delete all test cases, scripts, run history, heals, and reports. Type the project name to confirm.
              </Dialog.Description>

              <label style={LABEL_STYLE}>
                Type <strong style={{ color: 'var(--rose)' }}>{activeProject?.name}</strong> to confirm
              </label>
              <input
                className="input-field"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                placeholder={activeProject?.name}
                style={{ fontFamily: 'var(--font-ui)', marginBottom: '20px' }}
              />

              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <Dialog.Close asChild>
                  <button type="button" className="tb-btn tb-btn-ghost">
                    Cancel
                  </button>
                </Dialog.Close>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={confirmName !== activeProject?.name || deleteProject.isPending}
                  style={{
                    padding: '8px 18px',
                    background: 'var(--rose)',
                    border: 'none',
                    borderRadius: '6px',
                    color: '#fff',
                    fontSize: '13px',
                    fontWeight: 700,
                    cursor: confirmName !== activeProject?.name ? 'not-allowed' : 'pointer',
                    fontFamily: 'var(--font-ui)',
                    opacity: confirmName !== activeProject?.name ? 0.4 : 1,
                  }}
                >
                  {deleteProject.isPending ? 'Deleting…' : 'Delete Forever'}
                </button>
              </div>
            </Dialog.Content>
          </Dialog.Overlay>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────
const TABS = [
  { value: 'details',     label: '🏗 Details' },
  { value: 'environments',label: '🌐 Environments' },
  { value: 'members',     label: '👥 Members' },
  { value: 'req-library', label: '📁 Req Library' },
  { value: 'danger',      label: '⚠ Danger Zone' },
];

export default function ProjectSettings() {
  const { slug } = useParams<{ slug: string }>();
  const { activeProject } = useProjectStore();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('details');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Topbar
        breadcrumbs={[
          { label: 'All Projects', href: '/projects' },
          { label: activeProject?.name ?? slug ?? 'Project', href: `/projects/${slug}/dashboard` },
          { label: '⚙ Settings' },
        ]}
        actions={
          <>
            <TbBtn variant="ghost" onClick={() => navigate(`/projects/${slug}/copy-export`)}>
              📋 Copy / Export
            </TbBtn>
            <TbBtn variant="primary">💾 Save Changes</TbBtn>
          </>
        }
      />

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
        }}
      >
        {/* Page header */}
        <div>
          <div className="page-eyebrow">Project configuration</div>
          <h1 className="page-title">Project Settings</h1>
          {activeProject && (
            <p className="page-sub">{activeProject.description ?? activeProject.slug}</p>
          )}
        </div>

        {/* Tabs */}
        <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
          {/* Tab list */}
          <Tabs.List
            style={{
              display: 'flex',
              borderBottom: '1px solid var(--border)',
              overflowX: 'auto',
              marginBottom: '24px',
            }}
          >
            {TABS.map((t) => (
              <Tabs.Trigger
                key={t.value}
                value={t.value}
                style={TAB_TRIGGER_STYLE(activeTab === t.value)}
              >
                {t.label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>

          <Tabs.Content value="details">
            <DetailsTab />
          </Tabs.Content>
          <Tabs.Content value="environments">
            <EnvironmentsTab />
          </Tabs.Content>
          <Tabs.Content value="members">
            <MembersTab />
          </Tabs.Content>
          <Tabs.Content value="req-library">
            <ReqLibraryTab />
          </Tabs.Content>
          <Tabs.Content value="danger">
            <DangerZoneTab />
          </Tabs.Content>
        </Tabs.Root>
      </div>
    </div>
  );
}
