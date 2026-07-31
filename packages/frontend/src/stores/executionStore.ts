import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ExecutionStore {
  selectedTestCaseIds: string[];
  projectSlug: string | null;
  setSelected: (ids: string[], slug?: string) => void;
  addSelected: (ids: string[]) => void;
  clearSelected: () => void;
}

export const useExecutionStore = create<ExecutionStore>()(
  persist(
    (set) => ({
      selectedTestCaseIds: [],
      projectSlug: null,
      setSelected: (ids, slug) =>
        set({ selectedTestCaseIds: ids, ...(slug !== undefined ? { projectSlug: slug } : {}) }),
      addSelected: (ids) =>
        set((state) => ({
          selectedTestCaseIds: [
            ...state.selectedTestCaseIds,
            ...ids.filter((id) => !state.selectedTestCaseIds.includes(id)),
          ],
        })),
      clearSelected: () => set({ selectedTestCaseIds: [] }),
    }),
    { name: 'qa:execution-selection' },
  ),
);
