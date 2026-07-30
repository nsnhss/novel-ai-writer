import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { Channel } from "@tauri-apps/api/core";
import type { Material } from "./materialStore";
import { getEditorRef } from "@/lib/editorRef";
import { useBookStore } from "./bookStore";
import { useAppConfigStore } from "./appConfigStore";
import { useGenerationHistoryStore } from "./generationHistoryStore";

export interface StreamEvent {
  type: "Token" | "Usage" | "Error" | "Done";
  data:
    | string
    | {
        inputTokens: number;
        outputTokens: number;
        latencyMs: number;
        tokensPerSec: number;
      };
}

export interface SensoryWeights {
  visual: number;
  tactile: number;
  auditory: number;
  olfactory: number;
  mental: number;
}

export interface Atmosphere {
  gentleRough: number;
  implicitExplicit: number;
  romanticPrimitive: number;
  mentalAction: number;
  slowFast: number;
}

export interface GenerationParameters {
  temperature: number;
  topP: number;
  topK: number;
  repetitionPenalty: number;
  frequencyPenalty: number;
  maxTokens: number;
  sensoryWeights: SensoryWeights;
  atmosphere: Atmosphere;
}

export const DEFAULT_SENSORY_WEIGHTS: SensoryWeights = {
  visual: 20,
  tactile: 20,
  auditory: 20,
  olfactory: 20,
  mental: 20,
};

export const DEFAULT_ATMOSPHERE: Atmosphere = {
  gentleRough: 0,
  implicitExplicit: 0,
  romanticPrimitive: 0,
  mentalAction: 0,
  slowFast: 0,
};

export const DEFAULT_GENERATION_PARAMETERS: GenerationParameters = {
  temperature: 0.7,
  topP: 0.9,
  topK: 0,
  repetitionPenalty: 1.0,
  frequencyPenalty: 0.0,
  maxTokens: 2000,
  sensoryWeights: { ...DEFAULT_SENSORY_WEIGHTS },
  atmosphere: { ...DEFAULT_ATMOSPHERE },
};

export interface ContinueRequest {
  bookId: string;
  chapterId: string;
  cursorPrefix: string;
  ragQuery: string;
  requestType: "continue" | "rewrite" | "outline";
  selectedText?: string;
  instruction?: string;
  contentLevels?: string[];
  temperature?: number;
  topP?: number;
  topK?: number;
  repetitionPenalty?: number;
  frequencyPenalty?: number;
  maxTokens?: number;
  sceneTemplateId?: string;
  synopsis?: string;
}

export interface SubmitFeedbackRequest {
  logId: string;
  rating: number;
  accepted: boolean;
  content?: string;
  sourceName?: string;
  contentLevel?: string;
  comment?: string;
}

interface GenerationState {
  isGenerating: boolean;
  generatedText: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  tokensPerSec: number;
  currentLogId: string | null;
  error: string | null;
  params: GenerationParameters;
  pendingRagQuery: string | null;
  pendingRange: { from: number; to: number } | null;
  lastContinueRequest: ContinueRequest | null;
  rewriteOpen: boolean;
  rewriteOriginalText: string;
  rewriteRange: { from: number; to: number } | null;
  rewriteInstruction: string;
  rewritePendingRange: { from: number; to: number } | null;
  startContinue: (req: ContinueRequest, handlers: GenerationHandlers) => Promise<string | null>;
  abortGeneration: () => void;
  submitFeedback: (req: SubmitFeedbackRequest) => Promise<Material | null>;
  setParams: (params: Partial<GenerationParameters>) => void;
  saveParams: () => Promise<void>;
  loadParams: () => Promise<void>;
  setPendingRagQuery: (query: string | null) => void;
  consumePendingRagQuery: () => string | null;
  setPendingRange: (range: { from: number; to: number } | null) => void;
  acceptGeneration: (opts: { rating: number; contentLevel?: string; sourceName?: string }) => Promise<void>;
  rejectGeneration: (rating?: number) => Promise<void>;
  regenerate: () => Promise<void>;
  openRewriteDialog: (payload: { originalText: string; from: number; to: number; instruction: string; pendingRange?: { from: number; to: number } | null }) => void;
  openRewriteForSelection: (instruction?: string) => void;
  closeRewriteDialog: () => void;
  reset: () => void;
}

export interface GenerationHandlers {
  onStart: () => void;
  onToken: (token: string) => void;
  onUsage: (inputTokens: number, outputTokens: number, latencyMs: number, tokensPerSec: number) => void;
  onError: (error: string) => void;
  onDone: () => void;
}

export const useGenerationStore = create<GenerationState>((set, get) => ({
  isGenerating: false,
  generatedText: "",
  inputTokens: 0,
  outputTokens: 0,
  latencyMs: 0,
  tokensPerSec: 0,
  currentLogId: null,
  error: null,
  params: { ...DEFAULT_GENERATION_PARAMETERS },
  pendingRagQuery: null,
  pendingRange: null,
  lastContinueRequest: null,
  rewriteOpen: false,
  rewriteOriginalText: "",
  rewriteRange: null,
  rewriteInstruction: "",
  rewritePendingRange: null,

  startContinue: async (req, handlers) => {
    if (get().isGenerating) return null;

    set({ isGenerating: true, generatedText: "", inputTokens: 0, outputTokens: 0, currentLogId: null, error: null });
    handlers.onStart();

    const tokenBuffer: string[] = [];
    const channel = new Channel<StreamEvent>();
    channel.onmessage = (event) => {
      if (typeof event !== "object" || event === null) return;

      switch (event.type) {
        case "Token":
          if (typeof event.data === "string") {
            tokenBuffer.push(event.data);
            handlers.onToken(event.data);
          }
          break;
        case "Usage":
          if (typeof event.data === "object" && event.data !== null) {
            const usage = event.data as {
              inputTokens: number;
              outputTokens: number;
              latencyMs: number;
              tokensPerSec: number;
            };
            set({
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              latencyMs: usage.latencyMs,
              tokensPerSec: usage.tokensPerSec,
            });
            handlers.onUsage(usage.inputTokens, usage.outputTokens, usage.latencyMs, usage.tokensPerSec);
          }
          break;
        case "Error":
          if (typeof event.data === "string") {
            set({ error: event.data, isGenerating: false, generatedText: tokenBuffer.join("") });
            handlers.onError(event.data);
          }
          break;
        case "Done":
          set({ isGenerating: false, generatedText: tokenBuffer.join("") });
          handlers.onDone();
          break;
      }
    };

    try {
      const logId = await invoke<string>("stream_generate", { req, channel });
      set({ currentLogId: logId });
      if (req.requestType === "continue") {
        set({ lastContinueRequest: { ...req } });
      }
      return logId;
    } catch (err) {
      const message = String(err);
      set({ error: message, isGenerating: false });
      handlers.onError(message);
      return null;
    }
  },

  abortGeneration: async () => {
    try {
      await invoke("abort_generation");
    } catch (err) {
      console.error("中断失败:", err);
    }
    // 收尾：已生成部分保留为待确认高亮，用户可接受或拒绝（不再悬挂在半生成状态）
    getEditorRef()?.finishGeneration();
    set({ isGenerating: false });
  },

  submitFeedback: async (req) => {
    const material = await invoke<Material | null>("submit_generation_feedback", { req });
    return material;
  },

  rejectGeneration: async (rating = 1) => {
    const { currentLogId, generatedText } = get();
    const editor = getEditorRef();
    const { currentChapterId } = useBookStore.getState();
    try {
      if (editor) editor.rollbackGeneration();
      if (currentLogId) {
        await invoke("reject_generation", { id: currentLogId, rating });
      }
      if (currentChapterId) {
        await useGenerationHistoryStore.getState().saveHistory({
          chapterId: currentChapterId,
          requestType: "continue",
          content: generatedText,
          rating,
          accepted: false,
        });
      }
    } catch (err) {
      console.error("拒绝生成失败:", err);
    } finally {
      get().reset();
    }
  },

  acceptGeneration: async ({ rating, contentLevel = "general", sourceName = "AI 续写" }) => {
    const { currentLogId, generatedText } = get();
    const editor = getEditorRef();
    const { currentChapterId } = useBookStore.getState();
    if (!editor) return;
    if (!currentLogId) {
      // 后端未返回 logId（如日志写入失败）时也要能正常收尾，避免操作条卡死
      console.warn("接受生成：缺少 logId，跳过反馈入库");
      editor.commitGeneration();
      get().reset();
      return;
    }
    try {
      await get().submitFeedback({
        logId: currentLogId,
        rating,
        accepted: true,
        content: generatedText,
        sourceName,
        contentLevel,
      });
      editor.commitGeneration();
      const { adultMode } = useAppConfigStore.getState();
      if (adultMode && currentChapterId && generatedText.trim()) {
        await invoke("extract_body_state", { chapterId: currentChapterId, text: generatedText });
      }
      await useGenerationHistoryStore.getState().saveHistory({
        chapterId: currentChapterId ?? "",
        requestType: "continue",
        content: generatedText,
        rating,
        accepted: true,
      });
    } catch (err) {
      console.error("接受生成失败:", err);
    } finally {
      get().reset();
    }
  },

  regenerate: async () => {
    const { lastContinueRequest } = get();
    if (!lastContinueRequest) return;
    const editor = getEditorRef();
    if (!editor) return;
    const { currentBookId, currentChapterId } = useBookStore.getState();
    if (!currentBookId || !currentChapterId) return;

    if (get().currentLogId) {
      editor.rollbackGeneration();
    }
    get().reset();
    set({ pendingRange: null });

    editor.startGeneration();
    await get().startContinue(lastContinueRequest, {
      onStart: () => {},
      onToken: (token) => editor.appendGenerationToken(token),
      onUsage: () => {},
      onError: () => editor.finishGeneration(),
      onDone: () => editor.commitGeneration(),
    });
  },

  setParams: (params) => {
    set((state) => ({ params: { ...state.params, ...params } }));
  },

  saveParams: async () => {
    try {
      await invoke("set_generation_params", { params: JSON.stringify(get().params) });
    } catch (err) {
      console.error("保存生成参数失败:", err);
    }
  },

  loadParams: async () => {
    try {
      const raw = await invoke<string>("get_generation_params");
      const parsed = JSON.parse(raw) as Partial<GenerationParameters>;
      set({ params: { ...DEFAULT_GENERATION_PARAMETERS, ...parsed } });
    } catch (err) {
      console.error("加载生成参数失败:", err);
      set({ params: { ...DEFAULT_GENERATION_PARAMETERS } });
    }
  },

  setPendingRagQuery: (query) => set({ pendingRagQuery: query }),

  consumePendingRagQuery: () => {
    const query = get().pendingRagQuery;
    if (query !== null) set({ pendingRagQuery: null });
    return query;
  },

  setPendingRange: (range) => set({ pendingRange: range }),

  openRewriteDialog: ({ originalText, from, to, instruction, pendingRange = null }) => {
    set({
      rewriteOpen: true,
      rewriteOriginalText: originalText,
      rewriteRange: { from, to },
      rewriteInstruction: instruction,
      rewritePendingRange: pendingRange,
      generatedText: "",
      currentLogId: null,
      error: null,
    });
  },

  openRewriteForSelection: (instruction = "保持原意，优化表达") => {
    const editor = getEditorRef();
    if (!editor) return;
    const { pendingRange, generatedText } = get();
    const selection = editor.getSelectionRange();
    const target = selection.text.trim()
      ? selection
      : pendingRange
      ? { ...pendingRange, text: generatedText }
      : null;
    if (!target || !target.text.trim()) return;
    if (!selection.text.trim() && pendingRange) {
      editor.setSelection(pendingRange.from, pendingRange.to);
    }
    get().openRewriteDialog({
      originalText: target.text,
      from: target.from,
      to: target.to,
      instruction,
      pendingRange,
    });
  },

  closeRewriteDialog: () => {
    set({ rewriteOpen: false, rewriteOriginalText: "", rewriteRange: null, rewriteInstruction: "", rewritePendingRange: null });
  },

  reset: () => {
    set({
      isGenerating: false,
      generatedText: "",
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      tokensPerSec: 0,
      currentLogId: null,
      error: null,
      pendingRange: null,
    });
  },
}));
