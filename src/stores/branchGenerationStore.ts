import { create } from "zustand";
import { invoke, Channel } from "@tauri-apps/api/core";
import type { StreamEvent } from "./generationStore";

export interface BranchBaseRequest {
  bookId: string;
  chapterId: string;
  cursorPrefix: string;
  ragQuery: string;
  contentLevels: string[];
  sceneTemplateId?: string;
  temperature?: number;
  topP?: number;
  topK?: number;
  repetitionPenalty?: number;
  frequencyPenalty?: number;
  maxTokens?: number;
}

export interface BranchState {
  text: string;
  isLoading: boolean;
  error: string | null;
  rating: number;
}

interface BranchGenerationState {
  isOpen: boolean;
  isGenerating: boolean;
  groupId: string | null;
  cursorPrefix: string;
  baseRequest: BranchBaseRequest | null;
  branches: BranchState[];
  error: string | null;
  openDialog: (payload: BranchBaseRequest) => void;
  closeDialog: () => void;
  startBranches: () => Promise<void>;
  cancelBranch: (index: number) => void;
  cancelAll: () => void;
  regenerate: () => void;
  setBranchRating: (index: number, rating: number) => void;
  resetBranches: () => void;
}

const BRANCH_COUNT = 3;

const initialBranches = (): BranchState[] =>
  Array.from({ length: BRANCH_COUNT }, () => ({
    text: "",
    isLoading: false,
    error: null,
    rating: 3,
  }));

export const useBranchGenerationStore = create<BranchGenerationState>((set, get) => ({
  isOpen: false,
  isGenerating: false,
  groupId: null,
  cursorPrefix: "",
  baseRequest: null,
  branches: initialBranches(),
  error: null,

  openDialog: (payload) => {
    set({
      isOpen: true,
      groupId: crypto.randomUUID(),
      cursorPrefix: payload.cursorPrefix,
      baseRequest: payload,
      branches: initialBranches(),
      error: null,
    });
    get().startBranches();
  },

  closeDialog: () => {
    get().cancelAll();
    set({ isOpen: false });
  },

  startBranches: async () => {
    const { baseRequest, groupId, branches } = get();
    if (!baseRequest || !groupId) return;

    set({
      isGenerating: true,
      branches: branches.map((b) => ({ ...b, text: "", isLoading: true, error: null })),
      error: null,
    });

    const promises = Array.from({ length: BRANCH_COUNT }, (_, index) => {
      const channel = new Channel<StreamEvent>();
      channel.onmessage = (event) => {
        if (typeof event !== "object" || event === null) return;
        switch (event.type) {
          case "Token":
            if (typeof event.data === "string") {
              set((state) => ({
                branches: state.branches.map((b, i) =>
                  i === index ? { ...b, text: b.text + event.data } : b
                ),
              }));
            }
            break;
          case "Error":
            {
              const errMsg = typeof event.data === "string" ? event.data : String(event.data);
              set((state) => ({
                branches: state.branches.map((b, i) =>
                  i === index ? { ...b, isLoading: false, error: errMsg } : b
                ),
              }));
            }
            break;
          case "Done":
            set((state) => ({
              branches: state.branches.map((b, i) =>
                i === index ? { ...b, isLoading: false } : b
              ),
            }));
            break;
        }
      };

      return invoke<string>("stream_generate_branch", {
        req: {
          groupId,
          branchIndex: index,
          totalBranches: BRANCH_COUNT,
          base: {
            bookId: baseRequest.bookId,
            chapterId: baseRequest.chapterId,
            cursorPrefix: baseRequest.cursorPrefix,
            ragQuery: baseRequest.ragQuery,
            requestType: "continue",
            contentLevels: baseRequest.contentLevels,
            sceneTemplateId: baseRequest.sceneTemplateId,
            temperature: baseRequest.temperature,
            topP: baseRequest.topP,
            topK: baseRequest.topK,
            repetitionPenalty: baseRequest.repetitionPenalty,
            frequencyPenalty: baseRequest.frequencyPenalty,
            maxTokens: baseRequest.maxTokens,
          },
        },
        channel,
      }).catch((err: unknown) => {
        set((state) => ({
          branches: state.branches.map((b, i) =>
            i === index ? { ...b, isLoading: false, error: String(err) } : b
          ),
        }));
        return null;
      });
    });

    await Promise.all(promises);
    set({ isGenerating: false });
  },

  cancelBranch: (index: number) => {
    const { groupId } = get();
    if (!groupId) return;
    invoke("abort_generation_branch", { groupId, branchIndex: index }).catch(console.error);
  },

  cancelAll: () => {
    const { groupId, isGenerating } = get();
    if (!isGenerating || !groupId) return;
    Array.from({ length: BRANCH_COUNT }, (_, i) => i).forEach((i) => {
      invoke("abort_generation_branch", { groupId, branchIndex: i }).catch(console.error);
    });
  },

  regenerate: () => {
    const { baseRequest } = get();
    if (!baseRequest) return;
    set({
      groupId: crypto.randomUUID(),
      branches: initialBranches(),
      error: null,
    });
    get().startBranches();
  },

  setBranchRating: (index: number, rating: number) => {
    set((state) => ({
      branches: state.branches.map((b, i) => (i === index ? { ...b, rating } : b)),
    }));
  },

  resetBranches: () => {
    set({ branches: initialBranches() });
  },
}));
