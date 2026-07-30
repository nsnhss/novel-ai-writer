import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface SceneCard {
  id: string;
  bookId: string;
  name: string;
  description: string;
  location: string;
  timePeriod: string;
  atmosphere: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSceneRequest {
  bookId: string;
  name: string;
  description?: string;
  location?: string;
  timePeriod?: string;
  atmosphere?: string;
}

export interface UpdateSceneRequest {
  id: string;
  name?: string;
  description?: string;
  location?: string;
  timePeriod?: string;
  atmosphere?: string;
}

interface SceneCardState {
  scenes: SceneCard[];
  isLoading: boolean;
  loadScenes: (bookId: string) => Promise<void>;
  createScene: (req: CreateSceneRequest) => Promise<SceneCard>;
  updateScene: (req: UpdateSceneRequest) => Promise<SceneCard>;
  deleteScene: (id: string) => Promise<void>;
}

export const useSceneCardStore = create<SceneCardState>((set, get) => ({
  scenes: [],
  isLoading: false,

  loadScenes: async (bookId) => {
    set({ isLoading: true });
    try {
      const scenes = await invoke<SceneCard[]>("list_scenes", { bookId: bookId });
      set({ scenes });
    } finally {
      set({ isLoading: false });
    }
  },

  createScene: async (req) => {
    const scene = await invoke<SceneCard>("create_scene", { req });
    if (get().scenes[0]?.bookId === req.bookId) {
      await get().loadScenes(req.bookId);
    }
    return scene;
  },

  updateScene: async (req) => {
    const scene = await invoke<SceneCard>("update_scene", { req });
    set((state) => ({
      scenes: state.scenes.map((s) => (s.id === scene.id ? scene : s)),
    }));
    return scene;
  },

  deleteScene: async (id) => {
    await invoke<void>("delete_scene", { id });
    set((state) => ({
      scenes: state.scenes.filter((s) => s.id !== id),
    }));
  },
}));
