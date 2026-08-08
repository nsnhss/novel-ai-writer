import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface Material {
  id: string;
  sourceName: string;
  sourceType: string;
  content: string;
  plainText: string;
  contentLevel: string;
  rating: number;
  status: string;
  isNegative: boolean;
  styleFingerprint: string;
  hitCount: number;
  lastHitAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Tag {
  id: string;
  name: string;
  category: string;
  color: string;
}

export interface SearchResult {
  materialId: string;
  chunkIndex: number;
  chunkText: string;
  distance: number;
  isNegative?: boolean;
}

interface MaterialState {
  materials: Material[];
  tags: Tag[];
  isLoading: boolean;
  isImporting: boolean;
  importProgress: { stage: string; processed: number; total: number } | null;
  searchResults: SearchResult[];
  loadMaterials: (filters?: { statusFilter?: string | null; tagFilter?: string | null }) => Promise<void>;
  loadTags: () => Promise<void>;
  importMaterial: (filePath: string, tagIds: string[]) => Promise<void>;
  previewImportDuplicates: (filePath: string) => Promise<{ materialId: string; sourceName: string; maxSimilarity: number; matchedChunks: number }[]>;
  updateMaterial: (id: string, content?: string, sourceName?: string) => Promise<void>;
  updateMaterialContentLevel: (id: string, contentLevel: string) => Promise<void>;
  activateMaterial: (id: string) => Promise<void>;
  archiveMaterial: (id: string) => Promise<void>;
  rateMaterial: (id: string, rating: number) => Promise<void>;
  toggleMaterialNegative: (id: string, isNegative: boolean) => Promise<void>;
  deleteMaterial: (id: string) => Promise<void>;
  exportMaterials: (options: {
    format: "json" | "txt";
    statusFilter?: string | null;
    minRating?: number | null;
    maxRating?: number | null;
    sourceTypeFilter?: string | null;
    tagFilter?: string | null;
  }) => Promise<{ content: string; fileName: string }>;
  exportMaterialsEpub: (options: {
    statusFilter?: string | null;
    minRating?: number | null;
    maxRating?: number | null;
    sourceTypeFilter?: string | null;
    tagFilter?: string | null;
  }) => Promise<{ data: number[]; fileName: string }>;
  createTag: (name: string, category: string, color?: string) => Promise<void>;
  listTagCategories: () => Promise<string[]>;
  searchMaterials: (query: string, contentLevels?: string[]) => Promise<void>;
  searchMaterialsFts: (query: string) => Promise<void>;
  applyStorageTierMigration: () => Promise<{ removedArchived: number; removedCold: number; removedHotOverflow: number }>;
  getCleanupSuggestions: () => Promise<{ materialId: string; sourceName: string; reason: string }[]>;
  batchDeleteMaterials: (ids: string[]) => Promise<void>;
}

export const useMaterialStore = create<MaterialState>((set, get) => ({
  materials: [],
  tags: [],
  isLoading: false,
  isImporting: false,
  importProgress: null,
  searchResults: [],

  loadMaterials: async (filters) => {
    set({ isLoading: true });
    try {
      const materials = await invoke<Material[]>("list_materials", {
        statusFilter: filters?.statusFilter ?? null,
        tagFilter: filters?.tagFilter ?? null,
      });
      set({ materials });
    } finally {
      set({ isLoading: false });
    }
  },

  loadTags: async () => {
    const tags = await invoke<Tag[]>("list_tags", { categoryFilter: null });
    set({ tags });
  },

  importMaterial: async (filePath, tagIds) => {
    set({ isImporting: true, importProgress: { stage: "解析文件", processed: 0, total: 1 } });
    try {
      await invoke<Material>("import_material", {
        req: { filePath: filePath, tagIds: tagIds, autoTag: false },
      });
      await get().loadMaterials();
    } finally {
      set({ isImporting: false, importProgress: null });
    }
  },

  previewImportDuplicates: async (filePath) => {
    return invoke<{ materialId: string; sourceName: string; maxSimilarity: number; matchedChunks: number }[]>("preview_import_duplicates", { filePath });
  },

  activateMaterial: async (id) => {
    await invoke<Material>("update_material_status", { id, status: "active" });
    await get().loadMaterials();
  },

  archiveMaterial: async (id) => {
    await invoke<Material>("update_material_status", { id, status: "archived" });
    await get().loadMaterials();
  },

  rateMaterial: async (id, rating) => {
    await invoke<Material>("rate_material", { id, rating });
    await get().loadMaterials();
  },

  toggleMaterialNegative: async (id, isNegative) => {
    await invoke<Material>("update_material_negative", { id, isNegative });
    await get().loadMaterials();
  },

  deleteMaterial: async (id) => {
    await invoke<void>("delete_material", { id });
    await get().loadMaterials();
  },

  exportMaterials: async (options) => {
    return invoke<{ content: string; fileName: string }>("export_materials", {
      req: {
        format: options.format,
        statusFilter: options.statusFilter ?? null,
        minRating: options.minRating ?? null,
        maxRating: options.maxRating ?? null,
        sourceTypeFilter: options.sourceTypeFilter ?? null,
        tagFilter: options.tagFilter ?? null,
      },
    });
  },

  exportMaterialsEpub: async (options) => {
    return invoke<{ data: number[]; fileName: string }>("export_materials_epub", {
      req: {
        format: "epub",
        statusFilter: options.statusFilter ?? null,
        minRating: options.minRating ?? null,
        maxRating: options.maxRating ?? null,
        sourceTypeFilter: options.sourceTypeFilter ?? null,
        tagFilter: options.tagFilter ?? null,
      },
    });
  },

  updateMaterial: async (id, content, sourceName) => {
    await invoke<Material>("update_material", { req: { id, content, sourceName: sourceName } });
    await get().loadMaterials();
  },

  updateMaterialContentLevel: async (id, contentLevel) => {
    await invoke<Material>("update_material_content_level", { id, contentLevel });
    await get().loadMaterials();
  },

  searchMaterialsFts: async (query) => {
    if (!query.trim()) {
      set({ searchResults: [] });
      return;
    }
    const results = await invoke<SearchResult[]>("search_materials_fts", { query, limit: 10 });
    set({ searchResults: results });
  },

  createTag: async (name, category, color) => {
    await invoke<Tag>("create_tag", { name, category, color });
    await get().loadTags();
  },

  listTagCategories: async () => {
    return invoke<string[]>("list_tag_categories");
  },

  searchMaterials: async (query, contentLevels) => {
    if (!query.trim()) {
      set({ searchResults: [] });
      return;
    }
    const results = await invoke<SearchResult[]>("search_materials", {
      query,
      limit: 10,
      tagFilter: null,
      contentLevels: contentLevels && contentLevels.length > 0 ? contentLevels : null,
      statusFilter: null,
      decayLambda: 0.001,
    });
    set({ searchResults: results });
  },

  applyStorageTierMigration: async () => {
    return invoke<{ removedArchived: number; removedCold: number; removedHotOverflow: number }>(
      "apply_storage_tier_migration"
    );
  },

  getCleanupSuggestions: async () => {
    return invoke<{ materialId: string; sourceName: string; reason: string }[]>(
      "get_cleanup_suggestions"
    );
  },

  batchDeleteMaterials: async (ids) => {
    await invoke<void>("batch_delete_materials", { ids });
    await get().loadMaterials();
  },
}));
