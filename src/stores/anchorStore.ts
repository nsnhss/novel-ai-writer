import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface Anchor {
  id: string;
  bookId: string;
  content: string;
  category: string;
  isActive: boolean;
  createdAt: string;
}

export interface CreateAnchorRequest {
  bookId: string;
  content: string;
  category?: string;
}

export interface UpdateAnchorRequest {
  id: string;
  content?: string;
  category?: string;
  isActive?: boolean;
}

interface AnchorState {
  anchors: Anchor[];
  isLoading: boolean;
  loadAnchors: (bookId: string) => Promise<void>;
  createAnchor: (req: CreateAnchorRequest) => Promise<Anchor>;
  updateAnchor: (req: UpdateAnchorRequest) => Promise<Anchor>;
  deleteAnchor: (id: string) => Promise<void>;
}

export const useAnchorStore = create<AnchorState>((set, get) => ({
  anchors: [],
  isLoading: false,

  loadAnchors: async (bookId) => {
    if (!bookId) {
      set({ anchors: [] });
      return;
    }
    set({ isLoading: true });
    try {
      const anchors = await invoke<Anchor[]>("list_anchors", { bookId });
      set({ anchors });
    } finally {
      set({ isLoading: false });
    }
  },

  createAnchor: async (req) => {
    const anchor = await invoke<Anchor>("create_anchor", { req });
    if (get().anchors[0]?.bookId === req.bookId) {
      set((state) => ({ anchors: [anchor, ...state.anchors] }));
    }
    return anchor;
  },

  updateAnchor: async (req) => {
    const anchor = await invoke<Anchor>("update_anchor", { req });
    set((state) => ({
      anchors: state.anchors.map((a) => (a.id === anchor.id ? anchor : a)),
    }));
    return anchor;
  },

  deleteAnchor: async (id) => {
    await invoke<void>("delete_anchor", { id });
    set((state) => ({
      anchors: state.anchors.filter((a) => a.id !== id),
    }));
  },
}));
