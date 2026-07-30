import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface Budget {
  systemPrompt: number;
  styleProfile: number;
  anchors: number;
  characterSceneCards: number;
  volumeSummary: number;
  chapterSummary: number;
  ragChunks: number;
  cursorPrefix: number;
}

export interface ContextTokenCounts {
  systemPrompt: number;
  styleProfile: number;
  anchors: number;
  characters: number;
  scenes: number;
  volumeSummary: number;
  chapterSummaries: number;
  ragChunks: number;
  cursorPrefix: number;
  total: number;
}

export interface ContextRagChunk {
  materialId: string;
  chunkIndex: number;
  text: string;
  distance: number;
  isNegative?: boolean;
}

export interface ContextPayload {
  systemPrompt: string;
  styleProfile: string | null;
  anchors: string[];
  characters: string[];
  scenes: string[];
  volumeSummary: string | null;
  previousChapterSummaries: string[];
  currentChapterSummary: string | null;
  ragChunks: ContextRagChunk[];
  cursorPrefix: string;
  tokenCounts: ContextTokenCounts;
  truncationWarnings: string[];
}

export interface WritingContextRequest {
  bookId: string;
  chapterId: string;
  cursorPrefix: string;
  ragQuery: string;
  budget?: Budget;
  maxRagChunks?: number;
  contentLevels?: string[];
  sceneTemplateId?: string;
}

interface ContextState {
  currentContext: ContextPayload | null;
  renderedPrompt: string | null;
  isLoading: boolean;
  error: string | null;
  previewContext: (req: WritingContextRequest) => Promise<void>;
  renderContext: (req: WritingContextRequest) => Promise<void>;
  clearContext: () => void;
}

export const useContextStore = create<ContextState>((set) => ({
  currentContext: null,
  renderedPrompt: null,
  isLoading: false,
  error: null,

  previewContext: async (req) => {
    set({ isLoading: true, error: null });
    try {
      const payload = await invoke<ContextPayload>("get_writing_context", { req });
      set({ currentContext: payload, renderedPrompt: null });
    } catch (err) {
      set({ error: String(err) });
    } finally {
      set({ isLoading: false });
    }
  },

  renderContext: async (req) => {
    set({ isLoading: true, error: null });
    try {
      const prompt = await invoke<string>("render_writing_context", { req });
      set({ renderedPrompt: prompt });
    } catch (err) {
      set({ error: String(err) });
    } finally {
      set({ isLoading: false });
    }
  },

  clearContext: () => {
    set({ currentContext: null, renderedPrompt: null, error: null });
  },
}));
