import { create } from 'zustand';
import type { ChatContext } from '../types';

// 'minimized' is the permanent resting state (40px strip on the right edge).
// 'expanded' is the full 380px panel.
type SidebarMode = 'expanded' | 'minimized';

interface ChatSidebarStore {
  mode: SidebarMode;
  pendingPrompt?: string;
  pendingContext?: ChatContext;
  /** Open/expand with optional pre-filled prompt and context. */
  open: (opts?: { prompt?: string; context?: ChatContext }) => void;
  expand: () => void;
  minimize: () => void;
  toggle: () => void;
  clearPending: () => void;
  /** Legacy alias — same as minimize(). */
  close: () => void;
}

export const useChatSidebarStore = create<ChatSidebarStore>((set) => ({
  mode: 'minimized',
  pendingPrompt: undefined,
  pendingContext: undefined,

  open: (opts) => set({
    mode: 'expanded',
    pendingPrompt: opts?.prompt,
    pendingContext: opts?.context,
  }),

  expand: () => set({ mode: 'expanded' }),
  minimize: () => set({ mode: 'minimized' }),
  close: () => set({ mode: 'minimized' }),

  toggle: () => set((s) => ({
    mode: s.mode === 'expanded' ? 'minimized' : 'expanded',
  })),

  clearPending: () => set({ pendingPrompt: undefined, pendingContext: undefined }),
}));
