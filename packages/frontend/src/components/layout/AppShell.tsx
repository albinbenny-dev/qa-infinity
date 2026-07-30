import { useEffect } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import BrandBanner from './BrandBanner';
import Sidebar from './Sidebar';
import ChatWidget from '../chat/ChatWidget';
import ScanNotificationManager from '../scan/ScanNotificationManager';
import HealNotificationManager from '../healing/HealNotificationManager';
import { useProjectStore } from '../../stores/projectStore';
import { useProjects } from '../../hooks/useProjects';

export default function AppShell() {
  const { slug } = useParams<{ slug?: string }>();
  const { setActiveProject, setProjects } = useProjectStore();
  const { data: projects, isSuccess } = useProjects();

  useEffect(() => {
    if (isSuccess && projects) {
      setProjects(projects);
      if (slug) {
        const found = projects.find((p) => p.slug === slug) ?? null;
        setActiveProject(found);
      } else {
        setActiveProject(null);
      }
    }
  }, [isSuccess, projects, slug, setProjects, setActiveProject]);

  return (
    <div style={{ height: '100vh', overflow: 'hidden', background: 'var(--bg)' }}>
      {/* Global background listeners — fire notifications regardless of active page */}
      <ScanNotificationManager />
      <HealNotificationManager />

      {/* Fixed top banner */}
      <BrandBanner />

      {/* Layout below banner */}
      <div
        style={{
          marginTop: 'var(--banner-h)',
          height: 'calc(100vh - var(--banner-h))',
          display: 'flex',
          overflow: 'hidden',
        }}
      >
        <Sidebar slug={slug} />

        <main
          style={{
            flex: 1,
            minWidth: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Outlet />
        </main>

        {/* Chat sidebar — flex child so it pushes content rather than overlaying */}
        <ChatWidget />
      </div>
    </div>
  );
}
