import { useEffect, useMemo, useState } from "react";
import { Save, RotateCcw } from "lucide-react";
import {
  useShortcutStore,
  SHORTCUT_LABELS,
  formatShortcutFromEvent,
  findConflicts,
  type ShortcutAction,
} from "@/stores/shortcutStore";

export function ShortcutSettings() {
  const { shortcuts, loadShortcuts, saveShortcuts, resetToDefaults } = useShortcutStore();
  const [draft, setDraft] = useState<Record<ShortcutAction, string>>({ ...shortcuts });
  const [recording, setRecording] = useState<ShortcutAction | null>(null);

  useEffect(() => {
    loadShortcuts();
  }, [loadShortcuts]);

  useEffect(() => {
    setDraft({ ...shortcuts });
  }, [shortcuts]);

  const conflicts = useMemo(() => findConflicts(draft), [draft]);
  const hasChanges = useMemo(() => {
    return (Object.keys(draft) as ShortcutAction[]).some((k) => draft[k] !== shortcuts[k]);
  }, [draft, shortcuts]);

  const handleKeyDown = (action: ShortcutAction, event: React.KeyboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (["Escape", "Tab"].includes(event.key)) {
      setRecording(null);
      return;
    }

    const binding = formatShortcutFromEvent(event.nativeEvent);
    setDraft((prev) => ({ ...prev, [action]: binding }));
    setRecording(null);
  };

  const handleSave = async () => {
    if (conflicts.length > 0) return;
    await saveShortcuts(draft);
  };

  const handleReset = async () => {
    await resetToDefaults();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">快捷键</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs hover:bg-muted/80"
          >
            <RotateCcw size={12} /> 恢复默认
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges || conflicts.length > 0}
            className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Save size={12} /> 保存
          </button>
        </div>
      </div>

      {conflicts.length > 0 && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-500">
          存在冲突的快捷键：{conflicts.map((a) => SHORTCUT_LABELS[a]).join("、")}
        </div>
      )}

      <div className="space-y-2">
        {(Object.keys(SHORTCUT_LABELS) as ShortcutAction[]).map((action) => (
          <div
            key={action}
            className={`flex items-center justify-between rounded-md border border-panel-border p-2 ${
              conflicts.includes(action) ? "bg-red-500/5" : ""
            }`}
          >
            <span className="text-xs">{SHORTCUT_LABELS[action]}</span>
            <input
              type="text"
              readOnly
              data-shortcut-input
              value={draft[action]}
              onKeyDown={(e) => handleKeyDown(action, e)}
              onFocus={() => setRecording(action)}
              onBlur={() => setRecording(null)}
              placeholder={recording === action ? "按下快捷键…" : "点击设置"}
              className={`w-40 rounded-md bg-muted px-2 py-1 text-center text-xs outline-none ${
                conflicts.includes(action) ? "text-red-500" : ""
              } ${recording === action ? "ring-1 ring-primary" : ""}`}
            />
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        点击输入框后按下目标组合键即可设置；按 Escape 或 Tab 取消录制。
      </p>
    </div>
  );
}
