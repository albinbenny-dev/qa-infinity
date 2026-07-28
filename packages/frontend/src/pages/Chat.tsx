import { useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useChatSidebarStore } from '../stores/chatSidebarStore';

// ── Chat page — redirects to sidebar ──────────────────────────────────────
// The chat panel is a right sidebar (ChatWidget). This route reads URL params
// and opens the sidebar with the pre-filled context, then navigates to dashboard.

export default function Chat() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { open: openChat } = useChatSidebarStore();

  useEffect(() => {
    const tcId = searchParams.get('tcId') ?? undefined;
    const tcTitle = searchParams.get('tcTitle') ?? undefined;
    const page = searchParams.get('page') ?? undefined;
    const prompt = searchParams.get('prompt') ?? undefined;

    openChat({
      prompt,
      context: (tcId || page) ? { tcId, tcTitle, page } : undefined,
    });

    navigate(`/projects/${slug}/dashboard`, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
