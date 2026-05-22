import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import AppShell from './components/layout/AppShell';
import Login from './pages/Login';
import GlobalProjects from './pages/GlobalProjects';
import ProjectSettings from './pages/ProjectSettings';
import TestWriter from './pages/TestWriter';
import TCLibrary from './pages/TCLibrary';
import Scripts from './pages/Scripts';
import { isAuthenticated } from './lib/auth';

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
      <Route path="/register" element={<PlaceholderScreen title="Register" />} />

      {/* All protected pages — wrapped in AppShell */}
      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        {/* Global projects list */}
        <Route path="/projects" element={<GlobalProjects />} />

        {/* Per-project screens */}
        <Route path="/projects/:slug/dashboard"    element={<PlaceholderScreen title="Dashboard" />} />
        <Route path="/projects/:slug/writer"       element={<TestWriter />} />
        <Route path="/projects/:slug/tc-library"   element={<TCLibrary />} />
        <Route path="/projects/:slug/scripts"      element={<Scripts />} />
        <Route path="/projects/:slug/execution"    element={<PlaceholderScreen title="Execution" />} />
        <Route path="/projects/:slug/healing"      element={<PlaceholderScreen title="Healing Agent" />} />
        <Route path="/projects/:slug/reports"      element={<PlaceholderScreen title="Reports" />} />
        <Route path="/projects/:slug/chat"         element={<PlaceholderScreen title="Chat Agent" />} />
        <Route path="/projects/:slug/copy-export"  element={<PlaceholderScreen title="Copy / Export" />} />
        <Route path="/projects/:slug/settings"     element={<ProjectSettings />} />
      </Route>

      {/* Root redirect */}
      <Route path="/" element={<Navigate to="/projects" replace />} />
      <Route path="*" element={<Navigate to="/projects" replace />} />
    </Routes>
  );
}
