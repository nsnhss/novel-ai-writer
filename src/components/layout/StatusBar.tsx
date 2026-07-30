import { Loader2, Check, Circle, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useBookStore } from "@/stores/bookStore";
import { useModelStore } from "@/stores/modelStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useGenerationStore } from "@/stores/generationStore";

interface StatusBarProps {
  isSaving?: boolean;
  hasUnsavedChanges?: boolean;
  wordCount?: number;
}

export function StatusBar({ isSaving, hasUnsavedChanges, wordCount: propWordCount }: StatusBarProps) {
  const currentDocNode = useBookStore((s) => s.currentDocNode);
  const { currentModel, ollamaAvailable, checkOllamaStatus } = useModelStore(
    useShallow((s) => ({ currentModel: s.currentModel, ollamaAvailable: s.ollamaAvailable, checkOllamaStatus: s.checkOllamaStatus }))
  );
  const { enabled: privacyEnabled, loadMode, toggleEnabled } = usePrivacyStore(
    useShallow((s) => ({ enabled: s.enabled, loadMode: s.loadMode, toggleEnabled: s.toggleEnabled }))
  );
  const { latencyMs, tokensPerSec, genError } = useGenerationStore(
    useShallow((s) => ({ latencyMs: s.latencyMs, tokensPerSec: s.tokensPerSec, genError: s.error }))
  );
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const prevIsSavingRef = useRef(isSaving);
  const prevHasUnsavedRef = useRef(hasUnsavedChanges);

  useEffect(() => {
    loadMode();
    checkOllamaStatus();
    const timer = setInterval(() => checkOllamaStatus(), 30000);
    return () => clearInterval(timer);
  }, [loadMode, checkOllamaStatus]);

  useEffect(() => {
    const wasSaving = prevIsSavingRef.current;
    const wasUnsaved = prevHasUnsavedRef.current;

    if (wasSaving && !isSaving && !hasUnsavedChanges && wasUnsaved) {
      setLastSavedAt(new Date());
    }
    prevIsSavingRef.current = isSaving;
    prevHasUnsavedRef.current = hasUnsavedChanges;
  }, [isSaving, hasUnsavedChanges]);

  const wordCount = propWordCount ?? currentDocNode?.wordCount ?? 0;

  return (
    <div className="flex items-center justify-between border-t border-panel-border bg-panel px-3 py-1.5 text-xs text-muted-foreground">
      <div className="flex items-center gap-3">
        <span className="truncate max-w-[200px]">
          模型: {currentModel?.name ?? "未配置"}
        </span>
        <span
          className={cn(
            "flex items-center gap-1 truncate",
            ollamaAvailable === true ? "text-green-500" : ollamaAvailable === false ? "text-muted-foreground" : "text-muted-foreground"
          )}
          title={ollamaAvailable ? "本地 Ollama 可用" : "本地 Ollama 未运行"}
        >
          <Circle size={6} fill="currentColor" />
          {ollamaAvailable ? "本地模型可用" : "本地模型未运行"}
        </span>
        {latencyMs > 0 && (
          <span className="truncate">
            耗时: {(latencyMs / 1000).toFixed(2)}s
          </span>
        )}
        {tokensPerSec > 0 && (
          <span className="truncate">
            {tokensPerSec.toFixed(1)} tokens/s
          </span>
        )}
        {genError && (
          <span className="flex items-center gap-1 truncate max-w-[280px] text-red-500" title={genError}>
            生成失败: {genError}
          </span>
        )}
        <button
          onClick={toggleEnabled}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted"
          title={privacyEnabled ? "关闭隐私脱敏" : "开启隐私脱敏"}
        >
          {privacyEnabled ? <EyeOff size={12} className="text-primary" /> : <Eye size={12} />}
          <span className={privacyEnabled ? "text-primary" : ""}>{privacyEnabled ? "脱敏中" : "脱敏"}</span>
        </button>
      </div>
      <div className="flex items-center gap-3">
        <span>{wordCount} 字</span>
        {isSaving ? (
          <span className="flex items-center gap-1">
            <Loader2 size={10} className="animate-spin" />
            保存中…
          </span>
        ) : hasUnsavedChanges ? (
          <span className="flex items-center gap-1 text-orange-500">
            <Circle size={8} fill="currentColor" />
            未保存
          </span>
        ) : lastSavedAt ? (
          <span className="flex items-center gap-1 text-muted-foreground/60" title="上次保存时间">
            <Check size={10} />
            已保存 {lastSavedAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
          </span>
        ) : null}
      </div>
    </div>
  );
}
