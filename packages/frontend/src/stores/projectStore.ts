import { create } from 'zustand';
import type { Project, User } from '../types';
import { getCurrentUser } from '../lib/auth';

const THEME_KEY = 'qai-theme';
const DENSITY_KEY = 'qai-density';

function applyTheme(theme: 'light' | 'dark'): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

function applyDensity(density: 'normal' | 'compact'): void {
  const root = document.documentElement;
  if (density === 'compact') {
    root.setAttribute('data-density', 'compact');
    root.style.zoom = '90%';
  } else {
    root.removeAttribute('data-density');
    root.style.zoom = '';
  }
}

const savedTheme = (localStorage.getItem(THEME_KEY) as 'light' | 'dark') ?? 'light';
applyTheme(savedTheme);

const savedDensity = (localStorage.getItem(DENSITY_KEY) as 'normal' | 'compact') ?? 'normal';
applyDensity(savedDensity);

interface ProjectStore {
  activeProject: Project | null;
  setActiveProject: (p: Project | null) => void;
  projects: Project[];
  setProjects: (ps: Project[]) => void;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  density: 'normal' | 'compact';
  toggleDensity: () => void;
  currentUser: User | null;
  setCurrentUser: (u: User | null) => void;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  activeProject: null,
  setActiveProject: (p) => set({ activeProject: p }),
  projects: [],
  setProjects: (ps) => set({ projects: ps }),
  theme: savedTheme,
  toggleTheme: () => {
    const next = get().theme === 'light' ? 'dark' : 'light';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
    set({ theme: next });
  },
  density: savedDensity,
  toggleDensity: () => {
    const next = get().density === 'normal' ? 'compact' : 'normal';
    localStorage.setItem(DENSITY_KEY, next);
    applyDensity(next);
    set({ density: next });
  },
  currentUser: getCurrentUser(),
  setCurrentUser: (u) => set({ currentUser: u }),
}));
