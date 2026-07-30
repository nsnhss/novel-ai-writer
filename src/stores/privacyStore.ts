import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface PrivacyFilterRule {
  id: string;
  name: string;
  pattern: string;
  replacement: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePrivacyFilterRuleRequest {
  name: string;
  pattern: string;
  replacement: string;
}

export interface UpdatePrivacyFilterRuleRequest {
  id: string;
  name?: string;
  pattern?: string;
  replacement?: string;
  isActive?: boolean;
}

interface PrivacyState {
  enabled: boolean;
  rules: PrivacyFilterRule[];
  isLoading: boolean;
  loadRules: () => Promise<void>;
  loadMode: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  toggleEnabled: () => Promise<void>;
  createRule: (req: CreatePrivacyFilterRuleRequest) => Promise<PrivacyFilterRule>;
  updateRule: (req: UpdatePrivacyFilterRuleRequest) => Promise<PrivacyFilterRule>;
  deleteRule: (id: string) => Promise<void>;
  applyFilter: (text: string) => Promise<string>;
}

export const usePrivacyStore = create<PrivacyState>((set, get) => ({
  enabled: false,
  rules: [],
  isLoading: false,

  loadRules: async () => {
    set({ isLoading: true });
    try {
      const rules = await invoke<PrivacyFilterRule[]>("list_privacy_filter_rules");
      set({ rules });
    } finally {
      set({ isLoading: false });
    }
  },

  loadMode: async () => {
    const enabled = await invoke<boolean>("get_privacy_mode");
    set({ enabled });
  },

  setEnabled: async (enabled) => {
    await invoke("set_privacy_mode", { enabled });
    set({ enabled });
  },

  toggleEnabled: async () => {
    const next = !get().enabled;
    await invoke("set_privacy_mode", { enabled: next });
    set({ enabled: next });
  },

  createRule: async (req) => {
    const rule = await invoke<PrivacyFilterRule>("create_privacy_filter_rule", { req });
    await get().loadRules();
    return rule;
  },

  updateRule: async (req) => {
    const rule = await invoke<PrivacyFilterRule>("update_privacy_filter_rule", { req });
    set((state) => ({
      rules: state.rules.map((r) => (r.id === rule.id ? rule : r)),
    }));
    return rule;
  },

  deleteRule: async (id) => {
    await invoke<void>("delete_privacy_filter_rule", { id });
    set((state) => ({ rules: state.rules.filter((r) => r.id !== id) }));
  },

  applyFilter: async (text) => {
    return invoke<string>("apply_privacy_filter", { text });
  },
}));
