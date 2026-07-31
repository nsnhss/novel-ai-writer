import { Loader2, Check, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useBookStore } from "@/stores/bookStore";
import { useModelStore } from "@/stores/modelStore";
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
  const { latencyMs, tokensPerSec, genError } = useGenerationStore(
    useShallow((s) => ({ latencyMs: s.latencyMs, tokensPerSec: s.tokensPerSec, genError: s.error }))
  );
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const prevIsSavingRef = useRef(isSaving);
  const prevHasUnsavedRef = useRef(hasUnsavedChanges);

  useEffect(() => {
    checkOllamaStatus();
    const timer = setInterval(() => checkOllamaStatus(), 30000);
    return () => clearInterval(timer);
  }, [checkOllamaStatus]);

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
