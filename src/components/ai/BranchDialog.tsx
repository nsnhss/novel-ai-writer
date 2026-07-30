import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, X, Check, Star, RefreshCw, Square } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
import { useBranchGenerationStore } from "@/stores/branchGenerationStore";
import { useGenerationHistoryStore } from "@/stores/generationHistoryStore";
import { useBookStore } from "@/stores/bookStore";
import { useAppConfigStore } from "@/stores/appConfigStore";
import { getEditorRef } from "@/lib/editorRef";

const BRANCH_LABELS = [
  { title: "分支 A", subtitle: "偏动作 / 冲突" },
  { title: "分支 B", subtitle: "偏心理 / 情绪" },
  { title: "分支 C", subtitle: "偏对话 / 互动" },
];

export function BranchDialog() {
  const {
    isOpen,
    isGenerating,
    groupId,
    baseRequest,
    branches,
    closeDialog,
    cancelAll,
    regenerate,
    setBranchRating,
  } = useBranchGenerationStore();
  const { saveHistory } = useGenerationHistoryStore();
  const { currentChapterId } = useBookStore();
  const { adultMode, loadAdultMode } = useAppConfigStore();
  const [hasAdopted, setHasAdopted] = useState(false);

  useEffect(() => {
    loadAdultMode();
  }, [loadAdultMode]);
  const tempRangeRef = useRef<{ from: number; to: number } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setHasAdopted(false);
      tempRangeRef.current = null;
    }
  }, [isOpen]);

  const handleAdopt = async (index: number) => {
    const editor = getEditorRef();
    if (!editor || !baseRequest || !currentChapterId) return;

    const text = branches[index].text;
    if (!text) return;

    if (tempRangeRef.current) {
      editor.replaceRange(tempRangeRef.current.from, tempRangeRef.current.to, text);
      tempRangeRef.current = {
        from: tempRangeRef.current.from,
        to: tempRangeRef.current.from + text.length,
      };
    } else {
      const pos = editor.getSelectionRange().from;
      editor.replaceRange(pos, pos, text);
      tempRangeRef.current = { from: pos, to: pos + text.length };
    }

    setHasAdopted(true);

    if (adultMode && currentChapterId && text.trim()) {
      await invoke("extract_body_state", { chapterId: currentChapterId, text });
    }

    // Save all branches as history.
    if (groupId) {
      for (let i = 0; i < branches.length; i++) {
        await saveHistory({
          chapterId: currentChapterId,
          requestType: "continue",
          content: branches[i].text,
          rating: branches[i].rating,
          accepted: i === index,
          groupId,
          branchIndex: i,
          totalBranches: branches.length,
        });
      }
    }
  };

  const handleClose = () => {
    if (isGenerating) {
      cancelAll();
    }
    if (!hasAdopted && tempRangeRef.current) {
      const editor = getEditorRef();
      if (editor) {
        editor.replaceRange(tempRangeRef.current.from, tempRangeRef.current.to, "");
      }
    }
    closeDialog();
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex h-[85vh] w-[95vw] max-w-7xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-panel-border bg-panel shadow-xl outline-none">
          <div className="flex items-center justify-between border-b border-panel-border px-4 py-3">
            <div>
              <Dialog.Title className="text-sm font-medium">多分支续写</Dialog.Title>
              <p className="text-xs text-muted-foreground">同时生成 3 个方向，选择最符合预期的一版</p>
            </div>
            <div className="flex items-center gap-2">
              {isGenerating ? (
                <button
                  onClick={cancelAll}
                  className="flex items-center gap-1 rounded-md bg-muted px-2 py-1.5 text-xs hover:bg-muted/80"
                >
                  <Square size={12} /> 全部中断
                </button>
              ) : (
                <button
                  onClick={regenerate}
                  className="flex items-center gap-1 rounded-md bg-muted px-2 py-1.5 text-xs hover:bg-muted/80"
                >
                  <RefreshCw size={12} /> 重新生成
                </button>
              )}
              <button
                onClick={handleClose}
                className="rounded p-1 text-muted-foreground hover:bg-muted"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="grid flex-1 grid-cols-3 divide-x divide-panel-border overflow-hidden">
            {branches.map((branch, index) => (
              <div key={index} className="flex flex-col overflow-hidden">
                <div className="border-b border-panel-border bg-muted/30 px-3 py-2">
                  <div className="text-xs font-medium">{BRANCH_LABELS[index].title}</div>
                  <div className="text-[10px] text-muted-foreground">{BRANCH_LABELS[index].subtitle}</div>
                </div>

                <div className="flex-1 overflow-y-auto p-3 text-sm">
                  {branch.isLoading && branch.text === "" ? (
                    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                      <Loader2 size={14} className="mr-1 animate-spin" /> 生成中…
                    </div>
                  ) : branch.error && branch.text === "" ? (
                    <div className="text-xs text-red-500">{branch.error}</div>
                  ) : (
                    <div className="whitespace-pre-wrap text-foreground/90">{branch.text}</div>
                  )}
                  {branch.isLoading && branch.text !== "" && (
                    <span className="inline-block animate-pulse text-muted-foreground">▊</span>
                  )}
                </div>

                <div className="border-t border-panel-border p-3">
                  <div className="mb-2 flex items-center justify-center gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        onClick={() => setBranchRating(index, star)}
                        className={cn(
                          "rounded p-0.5",
                          branch.rating >= star ? "text-yellow-500" : "text-muted-foreground/30"
                        )}
                      >
                        <Star size={12} fill={branch.rating >= star ? "currentColor" : "none"} />
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => handleAdopt(index)}
                    disabled={branch.isLoading || !branch.text}
                    className="flex w-full items-center justify-center gap-1 rounded-md bg-primary px-2 py-1.5 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    <Check size={12} /> 采用此分支
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
