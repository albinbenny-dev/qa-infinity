import React from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
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
import RunDetail from './pages/RunDetail';
import Scheduler from './pages/Scheduler';
import Chat from './pages/Chat';
import Usage from './pages/Usage';
import UserManagement from './pages/UserManagement';
import RunMonitor from './pages/RunMonitor';
import Skills from './pages/Skills';
import Locators from './pages/Locators';
import CopyExport from './pages/CopyExport';
import OverallDashboard from './pages/OverallDashboard';
import { isAuthenticated } from './lib/auth';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { AppConfigProvider, useAppConfig } from './context/AppConfig';

// ── Protected route ────────────────────────────────────────────────────────
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

// ── AI-only route — redirects to dashboard in runner mode ─────────────────
function AiRoute({ element }: { element: React.ReactElement }) {
  const { mode } = useAppConfig();
  const { slug } = useParams<{ slug: string }>();
  if (mode === 'runner') {
    return <Navigate to={slug ? `/projects/${slug}/dashboard` : '/projects'} replace />;
  }
  return element;
}

// ── App ────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <AppConfigProvider>
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
          <Route path="/projects/:slug/writer"       element={<AiRoute element={<TestWriter />} />} />
          <Route path="/projects/:slug/tc-library"   element={<TCLibrary />} />
          <Route path="/projects/:slug/scripts"      element={<Scripts />} />
          <Route path="/projects/:slug/execution"    element={<Execution />} />
          <Route path="/projects/:slug/scheduler"    element={<Scheduler />} />
          <Route path="/projects/:slug/healing"      element={<AiRoute element={<Healing />} />} />
          <Route path="/projects/:slug/reports"      element={<Reports />} />
          <Route path="/projects/:slug/reports/runs/:runId" element={<RunDetail />} />
          <Route path="/projects/:slug/chat"         element={<AiRoute element={<Chat />} />} />
          <Route path="/projects/:slug/skills"       element={<AiRoute element={<Skills />} />} />
          <Route path="/projects/:slug/locators"     element={<AiRoute element={<Locators />} />} />
          <Route path="/projects/:slug/copy-export"  element={<CopyExport />} />
          <Route path="/projects/:slug/settings"     element={<ProjectSettings />} />
          <Route path="/overview"                    element={<OverallDashboard />} />
          <Route path="/usage"                       element={<AiRoute element={<Usage />} />} />
          <Route path="/admin/users"                 element={<UserManagement />} />
          <Route path="/admin/runs"                  element={<RunMonitor />} />
        </Route>

        {/* Root redirect */}
        <Route path="/" element={<Navigate to="/projects" replace />} />
        <Route path="*" element={<Navigate to="/projects" replace />} />
      </Routes>
    </AppConfigProvider>
  );
}
