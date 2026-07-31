import { useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/stores/uiStore";
import { ModelSettings } from "./ModelSettings";
import { PrivacyPanel } from "@/components/privacy/PrivacyPanel";
import { SystemPromptPanel } from "./SystemPromptPanel";
import { ShortcutSettings } from "./ShortcutSettings";
import { EmbeddingSettings } from "./EmbeddingSettings";
import { ExtensionSettings } from "./ExtensionSettings";
import { StoragePanel } from "./StoragePanel";
import { UpdateSettings } from "./UpdateSettings";

type SettingsGroup =
  | "model"
  | "embedding"
  | "appearance"
  | "privacy"
  | "prompt"
  | "shortcuts"
  | "extensions"
  | "storage"
  | "about";

const groups: { id: SettingsGroup; label: string }[] = [
  { id: "model", label: "模型 / API" },
  { id: "embedding", label: "嵌入" },
  { id: "appearance", label: "外观" },
  { id: "privacy", label: "隐私" },
  { id: "prompt", label: "Prompt" },
  { id: "shortcuts", label: "快捷键" },
  { id: "extensions", label: "扩展包" },
  { id: "storage", label: "存储" },
  { id: "about", label: "关于" },
];

function SegmentedOption<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex gap-1 rounded-md bg-muted p-1">
      {options.map((opt) => (
        <button
          key={String(opt.value)}
          onClick={() => onChange(opt.value)}
          className={cn(
            "flex-1 rounded px-3 py-1.5 text-sm transition-colors",
            value === opt.value
              ? "bg-background text-foreground shadow"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/** 外观设置：从旧 SettingsPanel 迁移并扩充（主题 / 字号 / 行高 / 栏宽） */
function AppearanceSettings() {
  const {
    theme,
    setTheme,
    editorFontSize,
    setEditorFontSize,
    editorLineHeight,
    setEditorLineHeight,
    editorMaxWidth,
    setEditorMaxWidth,
  } = useUIStore();

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-sm font-medium">主题</h3>
        <SegmentedOption
          options={[
            { label: "浅色", value: "light" as const },
            { label: "深色", value: "dark" as const },
          ]}
          value={theme}
          onChange={setTheme}
        />
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-medium">编辑器字号</h3>
        <SegmentedOption
          options={[
            { label: "15", value: 15 },
            { label: "16", value: 16 },
            { label: "18", value: 18 },
          ]}
          value={editorFontSize}
          onChange={setEditorFontSize}
        />
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-medium">行高</h3>
        <SegmentedOption
          options={[
            { label: "1.7", value: 1.7 },
            { label: "1.9", value: 1.9 },
            { label: "2.1", value: 2.1 },
          ]}
          value={editorLineHeight}
          onChange={setEditorLineHeight}
        />
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-medium">栏宽</h3>
        <SegmentedOption
          options={[
            { label: "640px", value: 640 },
            { label: "760px", value: 760 },
            { label: "920px", value: 920 },
          ]}
          value={editorMaxWidth}
          onChange={setEditorMaxWidth}
        />
      </div>
    </div>
  );
}

/** 全屏设置覆盖页：左侧分组导航 + 右侧滚动内容区 */
export function SettingsPage() {
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const [activeGroup, setActiveGroup] = useState<SettingsGroup>("model");

  return (
    <div className="fixed inset-0 z-40 flex bg-background">
      {/* 左侧分组导航 */}
      <div className="flex w-40 flex-shrink-0 flex-col gap-0.5 border-r border-border p-3 pt-14">
        {groups.map((group) => (
          <button
            key={group.id}
            onClick={() => setActiveGroup(group.id)}
            className={cn(
              "rounded-md px-3 py-2 text-left text-sm transition-colors",
              activeGroup === group.id
                ? "bg-muted text-accent"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            )}
          >
            {group.label}
          </button>
        ))}
      </div>

      {/* 右侧内容区 */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-6 py-3">
          <h2 className="text-base font-medium">设置</h2>
          <Button
            variant="ghost"
            size="icon"
            title="关闭设置"
            onClick={() => setSettingsOpen(false)}
          >
            <X size={16} />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-6 py-8">
            {activeGroup === "model" && <ModelSettings />}
            {activeGroup === "embedding" && <EmbeddingSettings />}
            {activeGroup === "appearance" && <AppearanceSettings />}
            {activeGroup === "privacy" && <PrivacyPanel />}
            {activeGroup === "prompt" && <SystemPromptPanel />}
            {activeGroup === "shortcuts" && <ShortcutSettings />}
            {activeGroup === "extensions" && <ExtensionSettings />}
            {activeGroup === "storage" && <StoragePanel />}
            {activeGroup === "about" && <UpdateSettings />}
          </div>
        </div>
      </div>
    </div>
  );
}
