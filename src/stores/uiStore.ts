import { create } from "zustand";
import { persist } from "zustand/middleware";

export type RightPanelTab = "ai" | "material" | "template" | "character" | "scene" | "anchor" | "styleProfile";

interface UIState {
  theme: "dark" | "light";
  leftSidebarWidth: number;
  rightSidebarWidth: number;
  leftSidebarCollapsed: boolean;
  rightSidebarCollapsed: boolean;
  rightPanelTab: RightPanelTab;
  /** 设置页（全屏覆盖层）是否打开 */
  settingsOpen: boolean;
  /** 左侧目录树各卷的展开状态（volumeId -> expanded），默认展开 */
  collapsedVolumes: Record<string, boolean>;
  /** AI 面板各手风琴分区的展开状态（"params" | "style"，true 表示展开，默认收起） */
  aiPanelSections: Record<string, boolean>;
  /** 编辑器排版设置（写入 documentElement 的 --editor-* CSS 变量） */
  editorFontSize: number;
  editorLineHeight: number;
  editorMaxWidth: number;
  setTheme: (theme: "dark" | "light") => void;
  setLeftSidebarWidth: (width: number) => void;
  setRightSidebarWidth: (width: number) => void;
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  setSettingsOpen: (open: boolean) => void;
  toggleVolumeCollapsed: (volumeId: string) => void;
  toggleAiPanelSection: (key: string) => void;
  setEditorFontSize: (px: number) => void;
  setEditorLineHeight: (lh: number) => void;
  setEditorMaxWidth: (px: number) => void;
}

const getInitialTheme = (): "dark" | "light" => {
  if (typeof window === "undefined") return "dark";
  const stored = localStorage.getItem("theme") as "dark" | "light" | null;
  if (stored) return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

function applyEditorVars(fontSize: number, lineHeight: number, maxWidth: number) {
  if (typeof document === "undefined") return;
  const el = document.documentElement.style;
  el.setProperty("--editor-font-size", `${fontSize}px`);
  el.setProperty("--editor-line-height", String(lineHeight));
  el.setProperty("--editor-max-width", `${maxWidth}px`);
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
  theme: getInitialTheme(),
  leftSidebarWidth: 260,
  rightSidebarWidth: 340,
  leftSidebarCollapsed: false,
  rightSidebarCollapsed: false,
  rightPanelTab: "ai",
  settingsOpen: false,
  collapsedVolumes: {},
  aiPanelSections: {},
  editorFontSize: 16,
  editorLineHeight: 1.9,
  editorMaxWidth: 760,
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
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  toggleVolumeCollapsed: (volumeId) =>
    set((state) => ({
      collapsedVolumes: { ...state.collapsedVolumes, [volumeId]: !state.collapsedVolumes[volumeId] },
    })),
  toggleAiPanelSection: (key) =>
    set((state) => ({
      aiPanelSections: { ...state.aiPanelSections, [key]: !state.aiPanelSections[key] },
    })),
  setEditorFontSize: (px) => {
    const { editorLineHeight, editorMaxWidth } = get();
    applyEditorVars(px, editorLineHeight, editorMaxWidth);
    set({ editorFontSize: px });
  },
  setEditorLineHeight: (lh) => {
    const { editorFontSize, editorMaxWidth } = get();
    applyEditorVars(editorFontSize, lh, editorMaxWidth);
    set({ editorLineHeight: lh });
  },
  setEditorMaxWidth: (px) => {
    const { editorFontSize, editorLineHeight } = get();
    applyEditorVars(editorFontSize, editorLineHeight, px);
    set({ editorMaxWidth: px });
  },
    }),
    {
      name: "novelWriter:ui",
      // theme 由独立 localStorage 键 "theme" 管理（含 prefers-color-scheme 回退），不重复持久化
      partialize: (state) => ({
        leftSidebarWidth: state.leftSidebarWidth,
        rightSidebarWidth: state.rightSidebarWidth,
        leftSidebarCollapsed: state.leftSidebarCollapsed,
        rightSidebarCollapsed: state.rightSidebarCollapsed,
        rightPanelTab: state.rightPanelTab,
        collapsedVolumes: state.collapsedVolumes,
        aiPanelSections: state.aiPanelSections,
        editorFontSize: state.editorFontSize,
        editorLineHeight: state.editorLineHeight,
        editorMaxWidth: state.editorMaxWidth,
      }),
      onRehydrateStorage: () => (state) => {
        // 持久化状态恢复后，把编辑器排版变量应用到 documentElement
        if (state) {
          applyEditorVars(state.editorFontSize, state.editorLineHeight, state.editorMaxWidth);
        }
      },
    }
  )
);

// Apply initial theme & editor typography on load
if (typeof window !== "undefined") {
  document.documentElement.setAttribute("data-theme", getInitialTheme());
}
