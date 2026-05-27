import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import AppShell from './components/layout/AppShell';
import Login from './pages/Login';
import Register from './pages/Register';
import GlobalProjects from './pages/GlobalProjects';
import ProjectSettings from './pages/ProjectSettings';
import TestWriter from './pages/TestWriter';
import TCLibrary from './pages/TCLibrary';
import Scripts from './pages/Scripts';
import Execution from './pages/Execution';
import Healing from './pages/Healing';
import Dashboard from './pages/Dashboard';
import Reports from './pages/Reports';
import Scheduler from './pages/Scheduler';
import Chat from './pages/Chat';
import Usage from './pages/Usage';
import UserManagement from './pages/UserManagement';
import { isAuthenticated } from './lib/auth';
import { ErrorBoundary } from './components/ui/ErrorBoundary';

// ── Protected route ────────────────────────────────────────────────────────
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

// ── Placeholder for screens not yet implemented ────────────────────────────
function PlaceholderScreen({ title }: { title: string }) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: '12px',
        padding: '40px',
      }}
    >
      <div style={{ fontSize: '48px', color: 'var(--6d-orange)' }}>∞</div>
      <h1 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text)' }}>{title}</h1>
      <p
        style={{
          fontSize: '12px',
          color: 'var(--text-dim)',
          fontFamily: 'var(--font-mono)',
          textAlign: 'center',
        }}
      >
        This screen is coming in an upcoming stage.
      </p>
    </div>
  );
}

// ── App ────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <Routes>
      {/* Auth pages — no shell */}
      <Route path="/login"    element={<Login />} />
      <Route path="/register" element={<Register />} />

      {/* All protected pages — wrapped in AppShell + ErrorBoundary */}
      <Route
        element={
          <ProtectedRoute>
            <ErrorBoundary>
              <AppShell />
            </ErrorBoundary>
          </ProtectedRoute>
        }
      >
        {/* Global projects list */}
        <Route path="/projects" element={<GlobalProjects />} />

        {/* Per-project screens */}
        <Route path="/projects/:slug/dashboard"    element={<Dashboard />} />
        <Route path="/projects/:slug/writer"       element={<TestWriter />} />
        <Route path="/projects/:slug/tc-library"   element={<TCLibrary />} />
        <Route path="/projects/:slug/scripts"      element={<Scripts />} />
        <Route path="/projects/:slug/execution"    element={<Execution />} />
        <Route path="/projects/:slug/scheduler"    element={<Scheduler />} />
        <Route path="/projects/:slug/healing"      element={<Healing />} />
        <Route path="/projects/:slug/reports"      element={<Reports />} />
        <Route path="/projects/:slug/chat"         element={<Chat />} />
        <Route path="/projects/:slug/copy-export"  element={<PlaceholderScreen title="Copy / Export" />} />
        <Route path="/projects/:slug/settings"     element={<ProjectSettings />} />
        <Route path="/usage"                       element={<Usage />} />
        <Route path="/admin/users"                 element={<UserManagement />} />
      </Route>

      {/* Root redirect */}
      <Route path="/" element={<Navigate to="/projects" replace />} />
      <Route path="*" element={<Navigate to="/projects" replace />} />
    </Routes>
  );
}
