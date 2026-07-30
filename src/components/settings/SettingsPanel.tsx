import { useState } from "react";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/stores/uiStore";
import { ModelSettings } from "./ModelSettings";
import { PrivacyPanel } from "@/components/privacy/PrivacyPanel";
import { SystemPromptPanel } from "./SystemPromptPanel";
import { ShortcutSettings } from "./ShortcutSettings";
import { EmbeddingSettings } from "./EmbeddingSettings";
import { ExtensionSettings } from "./ExtensionSettings";
import { StoragePanel } from "./StoragePanel";
import { UpdateSettings } from "./UpdateSettings";

type SettingsTab = "appearance" | "model" | "embedding" | "privacy" | "prompt" | "shortcuts" | "extensions" | "storage" | "about";

export function SettingsPanel() {
  const { theme, setTheme } = useUIStore();
  const [activeTab, setActiveTab] = useState<SettingsTab>("model");

  return (
    <div className="flex h-full flex-col p-3">
      <div className="mb-3 flex flex-wrap gap-1 rounded-md bg-muted p-1">
        <button
          onClick={() => setActiveTab("model")}
          className={cn(
            "flex-1 basis-[4rem] rounded py-1 text-xs transition-colors",
            activeTab === "model" ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground"
          )}
        >
          模型 / API
        </button>
        <button
          onClick={() => setActiveTab("embedding")}
          className={cn(
            "flex-1 basis-[4rem] rounded py-1 text-xs transition-colors",
            activeTab === "embedding" ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground"
          )}
        >
          嵌入
        </button>
        <button
          onClick={() => setActiveTab("appearance")}
          className={cn(
            "flex-1 basis-[4rem] rounded py-1 text-xs transition-colors",
            activeTab === "appearance" ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground"
          )}
        >
          外观
        </button>
        <button
          onClick={() => setActiveTab("privacy")}
          className={cn(
            "flex-1 basis-[4rem] rounded py-1 text-xs transition-colors",
            activeTab === "privacy" ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground"
          )}
        >
          隐私
        </button>
        <button
          onClick={() => setActiveTab("prompt")}
          className={cn(
            "flex-1 basis-[4rem] rounded py-1 text-xs transition-colors",
            activeTab === "prompt" ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground"
          )}
        >
          Prompt
        </button>
        <button
          onClick={() => setActiveTab("shortcuts")}
          className={cn(
            "flex-1 basis-[4rem] rounded py-1 text-xs transition-colors",
            activeTab === "shortcuts" ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground"
          )}
        >
          快捷键
        </button>
        <button
          onClick={() => setActiveTab("extensions")}
          className={cn(
            "flex-1 basis-[4rem] rounded py-1 text-xs transition-colors",
            activeTab === "extensions" ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground"
          )}
        >
          扩展包
        </button>
        <button
          onClick={() => setActiveTab("storage")}
          className={cn(
            "flex-1 basis-[4rem] rounded py-1 text-xs transition-colors",
            activeTab === "storage" ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground"
          )}
        >
          存储
        </button>
        <button
          onClick={() => setActiveTab("about")}
          className={cn(
            "flex-1 basis-[4rem] rounded py-1 text-xs transition-colors",
            activeTab === "about" ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground"
          )}
        >
          关于
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === "model" && <ModelSettings />}
        {activeTab === "embedding" && <EmbeddingSettings />}
        {activeTab === "privacy" && <PrivacyPanel />}
        {activeTab === "prompt" && <SystemPromptPanel />}
        {activeTab === "shortcuts" && <ShortcutSettings />}
        {activeTab === "extensions" && <ExtensionSettings />}
        {activeTab === "storage" && <StoragePanel />}
        {activeTab === "about" && <UpdateSettings />}
        {activeTab === "appearance" && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium">主题</h3>
            <div className="flex gap-2">
              <button
                onClick={() => setTheme("light")}
                className={cn(
                  "flex-1 rounded-md border px-3 py-2 text-sm",
                  theme === "light" && "border-primary bg-primary text-primary-foreground"
                )}
              >
                浅色
              </button>
              <button
                onClick={() => setTheme("dark")}
                className={cn(
                  "flex-1 rounded-md border px-3 py-2 text-sm",
                  theme === "dark" && "border-primary bg-primary text-primary-foreground"
                )}
              >
                深色
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
