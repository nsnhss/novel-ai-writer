import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, X, Check, Star } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
import { useBookStore } from "@/stores/bookStore";
import { useGenerationStore } from "@/stores/generationStore";
import { useGenerationHistoryStore } from "@/stores/generationHistoryStore";
import { useAppConfigStore } from "@/stores/appConfigStore";
import { getEditorRef } from "@/lib/editorRef";

export function RewriteDiffDialog() {
  const { currentBookId, currentChapterId, currentDocNode } = useBookStore();
  const {
    rewriteOpen,
    rewriteOriginalText,
    rewriteRange,
    rewriteInstruction,
    rewritePendingRange,
    generatedText,
    isGenerating,
    currentLogId,
    error,
    params,
    startContinue,
    submitFeedback,
    rejectGeneration,
    closeRewriteDialog,
    reset,
  } = useGenerationStore();
  const [rating, setRating] = useState(3);
  const hasStartedRef = useRef(false);

  useEffect(() => {
    if (rewriteOpen) {
      hasStartedRef.current = false;
      setRating(3);
    }
  }, [rewriteOpen]);

  useEffect(() => {
    if (
      !rewriteOpen ||
      hasStartedRef.current ||
      isGenerating ||
      generatedText !== "" ||
      !rewriteOriginalText ||
      !rewriteInstruction ||
      !currentBookId ||
      !currentChapterId
    ) {
      return;
    }

    hasStartedRef.current = true;
    const text = currentDocNode?.content ?? "";
    startContinue(
      {
        bookId: currentBookId,
        chapterId: currentChapterId,
        cursorPrefix: text,
        ragQuery: rewriteOriginalText,
        requestType: "rewrite",
        selectedText: rewriteOriginalText,
        instruction: rewriteInstruction,
        temperature: params.temperature,
        topP: params.topP,
        maxTokens: params.maxTokens,
      },
      {
        onStart: () => {},
        onToken: () => {},
        onUsage: () => {},
        onError: () => {},
        onDone: () => {},
      }
    );
  }, [
    rewriteOpen,
    isGenerating,
    generatedText,
    rewriteOriginalText,
    rewriteInstruction,
    currentBookId,
    currentChapterId,
    currentDocNode,
    params,
    startContinue,
  ]);

  const { saveHistory } = useGenerationHistoryStore();
  const { adultMode, loadAdultMode } = useAppConfigStore();

  useEffect(() => {
    loadAdultMode();
  }, [loadAdultMode]);

  const handleAccept = async () => {
    const editor = getEditorRef();
    if (!editor || !currentLogId || !currentChapterId) return;
    if (!rewriteRange && !rewritePendingRange) return;

    try {
      await submitFeedback({
        logId: currentLogId,
        rating,
        accepted: true,
        content: generatedText,
        sourceName: "AI 改写",
      });
      if (rewritePendingRange) {
        editor.replaceRange(rewritePendingRange.from, rewritePendingRange.to, generatedText);
      } else if (rewriteRange) {
        editor.replaceRange(rewriteRange.from, rewriteRange.to, generatedText);
      }
      editor.commitGeneration();
      if (adultMode && currentChapterId && generatedText.trim()) {
        await invoke("extract_body_state", { chapterId: currentChapterId, text: generatedText });
      }
      await saveHistory({
        chapterId: currentChapterId,
        requestType: "rewrite",
        instruction: rewriteInstruction,
        content: generatedText,
        rating,
        accepted: true,
      });
    } catch (err) {
      console.error("接受改写失败:", err);
    } finally {
      closeRewriteDialog();
      reset();
    }
  };

  const handleReject = async () => {
    if (!currentChapterId) return;
    try {
      await rejectGeneration(rating);
      await saveHistory({
        chapterId: currentChapterId,
        requestType: "rewrite",
        instruction: rewriteInstruction,
        content: generatedText,
        rating,
        accepted: false,
      });
    } finally {
      closeRewriteDialog();
      reset();
    }
  };

  return (
    <Dialog.Root open={rewriteOpen} onOpenChange={(open) => !open && handleReject()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex h-[80vh] w-[90vw] max-w-4xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-panel-border bg-panel shadow-xl outline-none">
          <div className="flex items-center justify-between border-b border-panel-border px-4 py-3">
            <Dialog.Title className="text-sm font-medium">AI 改写对比</Dialog.Title>
            <Dialog.Close asChild>
              <button className="rounded p-1 text-muted-foreground hover:bg-muted">
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex flex-1 overflow-hidden">
            <div className="flex flex-1 flex-col border-r border-panel-border">
              <div className="border-b border-panel-border px-3 py-2 text-xs font-medium text-muted-foreground">原文</div>
              <div className="flex-1 overflow-auto p-3">
                <pre className="whitespace-pre-wrap text-sm text-muted-foreground">{rewriteOriginalText}</pre>
              </div>
            </div>
            <div className="flex flex-1 flex-col">
              <div className="border-b border-panel-border px-3 py-2 text-xs font-medium text-muted-foreground">改写结果</div>
              <div className="relative flex-1 overflow-auto p-3">
                {isGenerating && generatedText === "" && (
                  <div className="absolute inset-0 flex items-center justify-center bg-panel/80">
                    <Loader2 size={24} className="animate-spin text-primary" />
                  </div>
                )}
                <pre className="whitespace-pre-wrap text-sm">{generatedText || "等待生成…"}</pre>
              </div>
            </div>
          </div>

          {error && (
            <div className="border-b border-panel-border bg-red-500/10 px-4 py-2 text-xs text-red-500">{error}</div>
          )}

          <div className="flex items-center justify-between border-t border-panel-border px-4 py-3">
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => setRating(star)}
                  className={cn("rounded p-0.5", rating >= star ? "text-yellow-500" : "text-muted-foreground/30")}
                >
                  <Star size={16} fill={rating >= star ? "currentColor" : "none"} />
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleReject}
                disabled={isGenerating}
                className="flex items-center gap-1 rounded-md bg-muted px-3 py-2 text-sm hover:bg-muted/80 disabled:opacity-50"
              >
                <X size={14} /> 放弃
              </button>
              <button
                onClick={handleAccept}
                disabled={isGenerating || !generatedText}
                className="flex items-center gap-1 rounded-md bg-green-600 px-3 py-2 text-sm text-white hover:bg-green-700 disabled:opacity-50"
              >
                <Check size={14} /> 接受
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
