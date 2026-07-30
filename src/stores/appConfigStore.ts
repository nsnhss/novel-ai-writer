import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

interface AppConfigState {
  adultMode: boolean;
  loadAdultMode: () => Promise<void>;
  setAdultMode: (enabled: boolean) => Promise<void>;
}

export const useAppConfigStore = create<AppConfigState>((set) => ({
  adultMode: false,

  loadAdultMode: async () => {
    try {
      const enabled = await invoke<boolean>("get_adult_mode");
      set({ adultMode: enabled });
    } catch (err) {
      console.error("加载成人模式失败:", err);
    }
  },

  setAdultMode: async (enabled) => {
    try {
      await invoke("set_adult_mode", { enabled });
      set({ adultMode: enabled });
    } catch (err) {
      console.error("设置成人模式失败:", err);
    }
  },
}));
