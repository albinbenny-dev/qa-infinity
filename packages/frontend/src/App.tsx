import { Routes, Route, Navigate } from 'react-router-dom';

// ── Placeholder screen component ───────────────────────────────────────────
function PlaceholderScreen({ title }: { title: string }) {
  return (
    <div className="min-h-screen bg-bg-base flex items-center justify-center">
      <div className="card text-center space-y-2 p-8">
        <div className="text-accent-cyan text-4xl font-bold">∞</div>
        <h1 className="text-text-primary text-xl font-semibold">{title}</h1>
        <p className="text-text-muted text-sm">Screen coming in next stage</p>
      </div>
    </div>
  );
}

// ── App ────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <Routes>
      {/* Root redirect */}
      <Route path="/" element={<Navigate to="/projects" replace />} />

      {/* Auth */}
      <Route path="/login" element={<PlaceholderScreen title="Login" />} />
      <Route path="/register" element={<PlaceholderScreen title="Register" />} />

      {/* Global project list */}
      <Route path="/projects" element={<PlaceholderScreen title="Projects" />} />

      {/* Per-project screens */}
      <Route
        path="/projects/:slug/dashboard"
        element={<PlaceholderScreen title="Dashboard" />}
      />
      <Route
        path="/projects/:slug/writer"
        element={<PlaceholderScreen title="Test Writer" />}
      />
      <Route
        path="/projects/:slug/tc-library"
        element={<PlaceholderScreen title="TC Library" />}
      />
      <Route
        path="/projects/:slug/scripts"
        element={<PlaceholderScreen title="Script Agent" />}
      />
      <Route
        path="/projects/:slug/execution"
        element={<PlaceholderScreen title="Execution" />}
      />
      <Route
        path="/projects/:slug/healing"
        element={<PlaceholderScreen title="Healing Agent" />}
      />
      <Route
        path="/projects/:slug/reports"
        element={<PlaceholderScreen title="Reports" />}
      />
      <Route
        path="/projects/:slug/chat"
        element={<PlaceholderScreen title="Chat Agent" />}
      />
      <Route
        path="/projects/:slug/copy-export"
        element={<PlaceholderScreen title="Copy / Export" />}
      />
      <Route
        path="/projects/:slug/settings"
        element={<PlaceholderScreen title="Project Settings" />}
      />

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/projects" replace />} />
    </Routes>
  );
}
