import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface AiModel {
  id: string;
  name: string;
  provider: string;
  endpoint: string;
  apiKeyRef?: string;
  modelName: string;
  parameters: string;
  recommendedFor: string;
  isDefault: boolean;
  createdAt: string;
}

export interface CreateModelRequest {
  name: string;
  provider: "ollama" | "openai_compatible";
  endpoint?: string;
  modelName: string;
  parameters?: string;
}

export interface UpdateModelRequest {
  id: string;
  name?: string;
  provider?: "ollama" | "openai_compatible";
  endpoint?: string;
  modelName?: string;
  parameters?: string;
}

export interface ModelRecommendation {
  name: string;
  provider: string;
  modelName: string;
  endpoint?: string;
  score: number;
  note: string;
  tags: string[];
  sampleOutput?: string;
}

const DEFAULT_MODEL_PARAMS = {
  temperature: 0.7,
  top_p: 0.9,
  top_k: 0,
  repetition_penalty: 1.0,
  frequency_penalty: 0.0,
  max_tokens: 2000,
};

interface ModelState {
  models: AiModel[];
  currentModel: AiModel | null;
  isLoading: boolean;
  ollamaAvailable: boolean | null;
  ollamaModels: string[];
  recommendations: ModelRecommendation[];
  loadModels: () => Promise<void>;
  loadCurrentModel: () => Promise<void>;
  createModel: (req: CreateModelRequest) => Promise<AiModel>;
  updateModel: (req: UpdateModelRequest) => Promise<AiModel>;
  deleteModel: (id: string) => Promise<void>;
  setDefaultModel: (id: string) => Promise<AiModel>;
  switchModel: (id: string) => Promise<AiModel>;
  setApiKey: (id: string, apiKey: string) => Promise<void>;
  hasApiKey: (id: string) => Promise<boolean>;
  testConnection: (id: string) => Promise<{ ok: boolean; error?: string }>;
  checkOllamaStatus: () => Promise<void>;
  loadRecommendations: () => Promise<void>;
  applyRecommendation: (rec: ModelRecommendation, apiKey?: string) => Promise<AiModel>;
}

function parseParameters(params: string): Record<string, unknown> {
  try {
    return JSON.parse(params);
  } catch {
    return {};
  }
}

export const useModelStore = create<ModelState>((set, get) => ({
  models: [],
  currentModel: null,
  isLoading: false,
  ollamaAvailable: null,
  ollamaModels: [],
  recommendations: [],

  loadModels: async () => {
    set({ isLoading: true });
    try {
      const models = await invoke<AiModel[]>("list_ai_models");
      set({ models });
    } finally {
      set({ isLoading: false });
    }
  },

  loadCurrentModel: async () => {
    const model = await invoke<AiModel | null>("get_current_ai_model");
    set({ currentModel: model });
  },

  createModel: async (req) => {
    const model = await invoke<AiModel>("create_ai_model", { req });
    await get().loadModels();
    if (model.isDefault) {
      await get().loadCurrentModel();
    }
    return model;
  },

  updateModel: async (req) => {
    const model = await invoke<AiModel>("update_ai_model", { req });
    await get().loadModels();
    if (get().currentModel?.id === model.id) {
      await get().switchModel(model.id);
    }
    return model;
  },

  deleteModel: async (id) => {
    await invoke<void>("delete_ai_model", { id });
    await get().loadModels();
    if (get().currentModel?.id === id) {
      const defaultModel = get().models.find((m) => m.isDefault);
      if (defaultModel) {
        await get().switchModel(defaultModel.id);
      } else {
        set({ currentModel: null });
      }
    }
  },

  setDefaultModel: async (id) => {
    await invoke<void>("set_default_ai_model", { id });
    await get().loadModels();
    const model = await get().switchModel(id);
    return model;
  },

  switchModel: async (id) => {
    const model = await invoke<AiModel>("switch_generation_model", { id });
    set({ currentModel: model });
    return model;
  },

  setApiKey: async (id, apiKey) => {
    await invoke<void>("set_model_api_key", { modelId: id, apiKey: apiKey });
    await get().loadModels();
  },

  hasApiKey: async (id) => {
    return invoke<boolean>("has_model_api_key", { modelId: id });
  },

  testConnection: async (id) => {
    return invoke<{ ok: boolean; error?: string }>("test_ai_model_connection", { id });
  },

  checkOllamaStatus: async () => {
    try {
      const status = await invoke<{ available: boolean; models: string[] }>("check_ollama_status");
      set({ ollamaAvailable: status.available, ollamaModels: status.models });
    } catch (err) {
      set({ ollamaAvailable: false, ollamaModels: [] });
    }
  },

  loadRecommendations: async () => {
    try {
      const recs = await invoke<ModelRecommendation[]>("list_model_recommendations");
      set({ recommendations: recs });
    } catch (err) {
      console.error("加载模型推荐失败:", err);
      set({ recommendations: [] });
    }
  },

  applyRecommendation: async (rec, apiKey) => {
    const endpoint = rec.endpoint ?? (rec.provider === "ollama" ? "http://localhost:11434" : "https://api.deepseek.com");
    const model = await get().createModel({
      name: rec.name,
      provider: rec.provider as "ollama" | "openai_compatible",
      endpoint,
      modelName: rec.modelName,
      parameters: JSON.stringify(DEFAULT_MODEL_PARAMS),
    });
    if (apiKey?.trim()) {
      await get().setApiKey(model.id, apiKey.trim());
    }
    return get().setDefaultModel(model.id);
  },
}));

export { parseParameters };
