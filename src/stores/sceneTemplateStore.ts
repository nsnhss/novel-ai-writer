import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface SceneTemplate {
  id: string;
  name: string;
  category: string;
  promptTemplate: string;
  isAdult: boolean;
  adultPrompt: string;
  beats: string;
  isBuiltin: boolean;
  createdAt: string;
}

export interface CreateSceneTemplateRequest {
  name: string;
  category: string;
  promptTemplate: string;
  isAdult?: boolean;
  adultPrompt?: string;
  beats?: string;
}

export interface UpdateSceneTemplateRequest {
  id: string;
  name?: string;
  category?: string;
  promptTemplate?: string;
  isAdult?: boolean;
  adultPrompt?: string;
  beats?: string;
}

interface SceneTemplateState {
  templates: SceneTemplate[];
  categories: string[];
  isLoading: boolean;
  loadTemplates: (categoryFilter?: string) => Promise<void>;
  loadCategories: () => Promise<void>;
  createTemplate: (req: CreateSceneTemplateRequest) => Promise<SceneTemplate>;
  updateTemplate: (req: UpdateSceneTemplateRequest) => Promise<SceneTemplate>;
  deleteTemplate: (id: string) => Promise<void>;
}

export const useSceneTemplateStore = create<SceneTemplateState>((set, get) => ({
  templates: [],
  categories: [],
  isLoading: false,

  loadTemplates: async (categoryFilter) => {
    set({ isLoading: true });
    try {
      const templates = await invoke<SceneTemplate[]>("list_scene_templates", {
        categoryFilter: categoryFilter || null,
      });
      set({ templates });
    } finally {
      set({ isLoading: false });
    }
  },

  loadCategories: async () => {
    const categories = await invoke<string[]>("list_scene_template_categories");
    set({ categories });
  },

  createTemplate: async (req) => {
    const template = await invoke<SceneTemplate>("create_scene_template", { req });
    await get().loadTemplates();
    await get().loadCategories();
    return template;
  },

  updateTemplate: async (req) => {
    const template = await invoke<SceneTemplate>("update_scene_template", { req });
    await get().loadTemplates();
    await get().loadCategories();
    return template;
  },

  deleteTemplate: async (id) => {
    await invoke<void>("delete_scene_template", { id });
    await get().loadTemplates();
    await get().loadCategories();
  },
}));
