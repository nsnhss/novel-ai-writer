import { create } from "zustand";

export type RightPanelTab = "ai" | "material" | "template" | "character" | "scene" | "anchor" | "styleProfile" | "settings";

interface UIState {
  theme: "dark" | "light";
  leftSidebarWidth: number;
  rightSidebarWidth: number;
  leftSidebarCollapsed: boolean;
  rightSidebarCollapsed: boolean;
  rightPanelTab: RightPanelTab;
  setTheme: (theme: "dark" | "light") => void;
  setLeftSidebarWidth: (width: number) => void;
  setRightSidebarWidth: (width: number) => void;
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
}

const getInitialTheme = (): "dark" | "light" => {
  if (typeof window === "undefined") return "dark";
  const stored = localStorage.getItem("theme") as "dark" | "light" | null;
  if (stored) return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

export const useUIStore = create<UIState>((set) => ({
  theme: getInitialTheme(),
  leftSidebarWidth: 260,
  rightSidebarWidth: 340,
  leftSidebarCollapsed: false,
  rightSidebarCollapsed: false,
  rightPanelTab: "ai",
  setTheme: (theme) => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
    set({ theme });
  },
  setLeftSidebarWidth: (width) => set({ leftSidebarWidth: Math.max(180, Math.min(400, width)) }),
  setRightSidebarWidth: (width) => set({ rightSidebarWidth: Math.max(240, Math.min(500, width)) }),
  toggleLeftSidebar: () => set((state) => ({ leftSidebarCollapsed: !state.leftSidebarCollapsed })),
  toggleRightSidebar: () => set((state) => ({ rightSidebarCollapsed: !state.rightSidebarCollapsed })),
  setRightPanelTab: (tab) => set({ rightPanelTab: tab }),
}));

// Apply initial theme on load
if (typeof window !== "undefined") {
  document.documentElement.setAttribute("data-theme", getInitialTheme());
}
