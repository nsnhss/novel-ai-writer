import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface StyleFeatures {
  sentenceLengthAvg: number;
  sentenceLengthStd: number;
  descriptionRatio: number;
  dialogueRatio: number;
  topKeywords: string[];
  description?: string;
  sexStyleFingerprint?: {
    malePartTerms: Record<string, number>;
    femalePartTerms: Record<string, number>;
    moanPatterns: Record<string, number>;
    dirtyWordUsage: number;
    positionDetailLevel: number;
    aftercareRatio: number;
  };
}

export interface StyleProfile {
  id: string;
  name: string;
  sourceMaterialIds: string;
  features: string;
  sentenceLengthAvg?: number;
  sentenceLengthStd?: number;
  descriptionRatio?: number;
  dialogueRatio?: number;
  topKeywords: string;
  updatedAt: string;
}

export interface CreateStyleProfileRequest {
  name: string;
  materialIds: string[];
}

interface StyleProfileState {
  profiles: StyleProfile[];
  activeProfileId: string | null;
  isLoading: boolean;
  error: string | null;
  autoRecalibrate: boolean;
  loadProfiles: () => Promise<void>;
  loadActiveProfileId: () => Promise<void>;
  setActiveProfileId: (id: string | null) => Promise<void>;
  extractProfile: (req: CreateStyleProfileRequest) => Promise<StyleProfile>;
  deleteProfile: (id: string) => Promise<void>;
  recalibrateProfile: (profileId?: string) => Promise<{
    profileId: string;
    sampleCount: number;
    avgRating: number;
    previous: StyleFeatureSnapshot;
    current: StyleFeatureSnapshot;
  }>;
  evaluateDrift: (text: string) => Promise<{ driftScore: number; interpretation: string }>;
  loadAutoRecalibrate: () => Promise<void>;
  setAutoRecalibrate: (enabled: boolean) => Promise<void>;
  clearError: () => void;
}

export interface StyleFeatureSnapshot {
  sentenceLengthAvg: number;
  sentenceLengthStd: number;
  descriptionRatio: number;
  dialogueRatio: number;
}

export const useStyleProfileStore = create<StyleProfileState>((set, get) => ({
  profiles: [],
  activeProfileId: null,
  isLoading: false,
  error: null,
  autoRecalibrate: false,
  clearError: () => set({ error: null }),

  loadProfiles: async () => {
    set({ isLoading: true, error: null });
    try {
      const profiles = await invoke<StyleProfile[]>("list_style_profiles");
      set({ profiles });
    } catch (err) {
      set({ error: String(err) });
    } finally {
      set({ isLoading: false });
    }
  },

  loadActiveProfileId: async () => {
    try {
      const id = await invoke<string | null>("get_active_style_profile_id");
      set({ activeProfileId: id });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  setActiveProfileId: async (id) => {
    try {
      await invoke("set_active_style_profile_id", { id });
      set({ activeProfileId: id, error: null });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  extractProfile: async (req) => {
    set({ error: null });
    try {
      const profile = await invoke<StyleProfile>("extract_style_profile", { req });
      await get().loadProfiles();
      await get().setActiveProfileId(profile.id);
      return profile;
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },

  deleteProfile: async (id) => {
    set({ error: null });
    try {
      await invoke("delete_style_profile", { id });
      await get().loadProfiles();
      if (get().activeProfileId === id) {
        await get().setActiveProfileId(null);
      }
    } catch (err) {
      set({ error: String(err) });
    }
  },

  recalibrateProfile: async (profileId) => {
    set({ error: null });
    try {
      const result = await invoke<{
        profileId: string;
        sampleCount: number;
        avgRating: number;
        previous: StyleFeatureSnapshot;
        current: StyleFeatureSnapshot;
      }>("recalibrate_active_style_profile", {
        req: { profileId: profileId ?? null, windowDays: null, minRating: null },
      });
      await get().loadProfiles();
      return result;
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },

  evaluateDrift: async (text) => {
    set({ error: null });
    try {
      return await invoke<{ driftScore: number; interpretation: string }>("evaluate_style_drift", {
        req: { text },
      });
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },

  loadAutoRecalibrate: async () => {
    try {
      const enabled = await invoke<boolean>("get_auto_recalibrate_style_profile");
      set({ autoRecalibrate: enabled });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  setAutoRecalibrate: async (enabled) => {
    try {
      await invoke("set_auto_recalibrate_style_profile", { enabled });
      set({ autoRecalibrate: enabled, error: null });
    } catch (err) {
      set({ error: String(err) });
    }
  },
}));

export function parseStyleFeatures(profile?: StyleProfile | null): StyleFeatures | null {
  if (!profile?.features) return null;
  try {
    return JSON.parse(profile.features) as StyleFeatures;
  } catch {
    return null;
  }
}
