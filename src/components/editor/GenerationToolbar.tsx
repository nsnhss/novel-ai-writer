import { useState } from "react";
import { Check, X, Edit3, RefreshCw, Copy, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGenerationStore } from "@/stores/generationStore";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { loadLastRating, saveLastRating } from "@/lib/rating";

export function GenerationToolbar() {
  const {
    generatedText,
    isGenerating,
    acceptGeneration,
    rejectGeneration,
    regenerate,
    openRewriteForSelection,
  } = useGenerationStore();
  // 记住上次评分（与 AIPanel/改写对话框共用同一份），避免每次生成都重置为 3 星
  const [rating, setRatingState] = useState(loadLastRating);
  const setRating = (star: number) => {
    setRatingState(star);
    saveLastRating(star);
  };
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(generatedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  };

  return (
    <div className="mt-1 flex items-center gap-1 rounded-lg border border-panel-border bg-panel/95 p-1.5 shadow-lg backdrop-blur">
      <div className="flex items-center gap-0.5 border-r border-panel-border pr-1.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            onClick={() => setRating(star)}
            className={cn(
              "rounded p-0.5",
              rating >= star ? "text-yellow-500" : "text-muted-foreground/30"
            )}
            title={`评分 ${star}`}
          >
            <Star size={12} fill={rating >= star ? "currentColor" : "none"} />
          </button>
        ))}
      </div>

      <button
        onClick={() => acceptGeneration({ rating, contentLevel: "general", sourceName: "AI 续写" })}
        disabled={isGenerating}
        className="flex items-center gap-1 rounded bg-green-600/90 px-2 py-1 text-xs text-white hover:bg-green-700 disabled:opacity-50"
        title="接受生成结果"
      >
        <Check size={12} /> 接受
      </button>

      <button
        onClick={async () => {
          // 拒绝会移除已生成文本且不可恢复，二次确认防误点
          const ok = await confirmDialog({
            title: "拒绝此次生成？",
            description: "已生成内容将被移除，此操作不可恢复。",
            confirmText: "拒绝",
            danger: true,
          });
          if (ok) rejectGeneration(rating);
        }}
        disabled={isGenerating}
        className="flex items-center gap-1 rounded bg-red-600/90 px-2 py-1 text-xs text-white hover:bg-red-700 disabled:opacity-50"
        title="拒绝并恢复原文"
      >
        <X size={12} /> 拒绝
      </button>

      <button
        onClick={() => openRewriteForSelection("保持原意，优化表达")}
        disabled={isGenerating}
        className="flex items-center gap-1 rounded bg-muted px-2 py-1 text-xs hover:bg-muted/80 disabled:opacity-50"
        title="局部编辑"
      >
        <Edit3 size={12} /> 局部编辑
      </button>

      <button
        onClick={regenerate}
        disabled={isGenerating}
        className="flex items-center gap-1 rounded bg-muted px-2 py-1 text-xs hover:bg-muted/80 disabled:opacity-50"
        title="重新生成"
      >
        <RefreshCw size={12} /> 再次生成
      </button>

      <button
        onClick={handleCopy}
        disabled={isGenerating}
        className="flex items-center gap-1 rounded bg-muted px-2 py-1 text-xs hover:bg-muted/80 disabled:opacity-50"
        title="复制生成结果"
      >
        <Copy size={12} /> {copied ? "已复制" : "复制"}
      </button>
    </div>
  );
}
