import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export type ShortcutAction =
  | "save"
  | "continue"
  | "rewrite"
  | "undo"
  | "redo"
  | "search"
  | "close_panel";

export const DEFAULT_SHORTCUTS: Record<ShortcutAction, string> = {
  save: "Ctrl+S",
  continue: "Ctrl+Enter",
  rewrite: "Ctrl+Shift+Enter",
  undo: "Ctrl+Z",
  redo: "Ctrl+Y",
  search: "Ctrl+F",
  close_panel: "Escape",
};

export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  save: "保存",
  continue: "续写",
  rewrite: "改写",
  undo: "撤销",
  redo: "重做",
  search: "搜索",
  close_panel: "关闭面板 / Esc",
};

interface ShortcutState {
  shortcuts: Record<ShortcutAction, string>;
  isLoading: boolean;
  loadShortcuts: () => Promise<void>;
  saveShortcuts: (shortcuts: Record<ShortcutAction, string>) => Promise<void>;
  resetToDefaults: () => Promise<void>;
}

export const useShortcutStore = create<ShortcutState>((set, get) => ({
  shortcuts: { ...DEFAULT_SHORTCUTS },
  isLoading: false,

  loadShortcuts: async () => {
    set({ isLoading: true });
    try {
      const raw = await invoke<string>("get_keyboard_shortcuts");
      const parsed = parseShortcutsJson(raw);
      set({ shortcuts: { ...DEFAULT_SHORTCUTS, ...parsed } });
    } finally {
      set({ isLoading: false });
    }
  },

  saveShortcuts: async (shortcuts) => {
    await invoke("set_keyboard_shortcuts", { shortcuts: JSON.stringify(shortcuts) });
    set({ shortcuts: { ...shortcuts } });
  },

  resetToDefaults: async () => {
    await get().saveShortcuts({ ...DEFAULT_SHORTCUTS });
  },
}));

function parseShortcutsJson(raw: string): Partial<Record<ShortcutAction, string>> {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Partial<Record<ShortcutAction, string>>;
    }
  } catch {
    // ignore
  }
  return {};
}

export function formatShortcutFromEvent(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");

  let key = event.key;
  if (key === " ") key = "Space";
  if (key.length === 1) key = key.toUpperCase();

  // Avoid adding modifiers again if key is the modifier name itself.
  if (["Control", "Alt", "Shift", "Meta"].includes(key)) {
    return parts.join("+");
  }

  if (key === "Escape") key = "Escape";
  if (key === "Enter") key = "Enter";
  if (key === "Tab") key = "Tab";
  if (key === "Backspace") key = "Backspace";
  if (key === "Delete") key = "Delete";
  if (key === "ArrowUp") key = "Up";
  if (key === "ArrowDown") key = "Down";
  if (key === "ArrowLeft") key = "Left";
  if (key === "ArrowRight") key = "Right";

  parts.push(key);
  return parts.join("+");
}

export function matchesShortcut(event: KeyboardEvent, binding: string): boolean {
  const normalizedBinding = normalizeBinding(binding);
  if (!normalizedBinding) return false;

  const parts = normalizedBinding.split("+");
  const keyPart = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);

  const eventKey = normalizeKey(event.key);

  if (eventKey !== keyPart && event.code !== keyPart) return false;

  const hasCtrl = modifiers.includes("Ctrl");
  const hasAlt = modifiers.includes("Alt");
  const hasShift = modifiers.includes("Shift");

  if (hasCtrl !== (event.ctrlKey || event.metaKey)) return false;
  if (hasAlt !== event.altKey) return false;
  if (hasShift !== event.shiftKey) return false;

  return true;
}

function normalizeBinding(binding: string): string {
  return binding
    .split(/[+\s]/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => {
      const lower = p.toLowerCase();
      if (lower === "ctrl" || lower === "control" || lower === "cmd" || lower === "command" || lower === "meta")
        return "Ctrl";
      if (lower === "alt" || lower === "option") return "Alt";
      if (lower === "shift") return "Shift";
      if (lower === "esc") return "Escape";
      if (lower === "space" || lower === " ") return "Space";
      if (lower.length === 1) return lower.toUpperCase();
      return p.charAt(0).toUpperCase() + p.slice(1);
    })
    .join("+");
}

function normalizeKey(key: string): string {
  if (key === " ") return "Space";
  if (key === "Escape") return "Escape";
  if (key === "Enter") return "Enter";
  if (key === "Tab") return "Tab";
  if (key === "Backspace") return "Backspace";
  if (key === "Delete") return "Delete";
  if (key === "ArrowUp") return "Up";
  if (key === "ArrowDown") return "Down";
  if (key === "ArrowLeft") return "Left";
  if (key === "ArrowRight") return "Right";
  if (key.length === 1) return key.toUpperCase();
  return key;
}

export function findConflicts(shortcuts: Record<ShortcutAction, string>): ShortcutAction[] {
  const conflicts = new Set<ShortcutAction>();
  const entries = Object.entries(shortcuts) as [ShortcutAction, string][];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [a, bindingA] = entries[i];
      const [b, bindingB] = entries[j];
      if (bindingA.trim() && normalizeBinding(bindingA) === normalizeBinding(bindingB)) {
        conflicts.add(a);
        conflicts.add(b);
      }
    }
  }
  return Array.from(conflicts);
}
