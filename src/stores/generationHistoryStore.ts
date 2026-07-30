import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface GenerationHistoryItem {
  id: string;
  chapterId: string;
  requestType: string;
  instruction: string;
  content: string;
  rating: number;
  accepted: boolean;
  groupId?: string;
  branchIndex: number;
  totalBranches: number;
  createdAt: string;
}

export interface SaveGenerationHistoryRequest {
  chapterId: string;
  requestType: string;
  instruction?: string;
  content: string;
  rating?: number;
  accepted?: boolean;
  groupId?: string;
  branchIndex?: number;
  totalBranches?: number;
}

interface GenerationHistoryState {
  history: GenerationHistoryItem[];
  isLoading: boolean;
  loadHistory: (chapterId: string) => Promise<void>;
  saveHistory: (req: SaveGenerationHistoryRequest) => Promise<void>;
  deleteHistory: (id: string) => Promise<void>;
}

export const useGenerationHistoryStore = create<GenerationHistoryState>((set, get) => ({
  history: [],
  isLoading: false,

  loadHistory: async (chapterId) => {
    if (!chapterId) {
      set({ history: [] });
      return;
    }
    set({ isLoading: true });
    try {
      const items = await invoke<GenerationHistoryItem[]>("list_generation_history", { chapterId });
      set({ history: items });
    } catch (err) {
      console.error("加载生成历史失败:", err);
    } finally {
      set({ isLoading: false });
    }
  },

  saveHistory: async (req) => {
    try {
      await invoke("save_generation_history", { req });
      if (req.chapterId) {
        await get().loadHistory(req.chapterId);
      }
    } catch (err) {
      console.error("保存生成历史失败:", err);
    }
  },

  deleteHistory: async (id) => {
    try {
      await invoke("delete_generation_history", { id });
      set((state) => ({ history: state.history.filter((h) => h.id !== id) }));
    } catch (err) {
      console.error("删除生成历史失败:", err);
    }
  },
}));
