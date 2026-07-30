import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, X, Check } from "lucide-react";
import { useBookStore } from "@/stores/bookStore";
import { useGenerationStore } from "@/stores/generationStore";
import { useGenerationHistoryStore } from "@/stores/generationHistoryStore";
import { getEditorRef } from "@/lib/editorRef";

interface OutlineDialogProps {
  open: boolean;
  onClose: () => void;
}

export function OutlineDialog({ open, onClose }: OutlineDialogProps) {
  const { currentBookId, currentChapterId, currentDocNode } = useBookStore();
  const {
    generatedText,
    isGenerating,
    error,
    params,
    startContinue,
    reset,
  } = useGenerationStore();
  const [synopsis, setSynopsis] = useState("");
  const hasStartedRef = useRef(false);

  useEffect(() => {
    if (open) {
      hasStartedRef.current = false;
      setSynopsis("");
      reset();
    }
  }, [open, reset]);

  const handleGenerate = () => {
    if (!synopsis.trim() || !currentBookId || !currentChapterId) return;
    hasStartedRef.current = true;
    const text = currentDocNode?.content ?? "";
    startContinue(
      {
        bookId: currentBookId,
        chapterId: currentChapterId,
        cursorPrefix: text,
        ragQuery: synopsis.trim(),
        requestType: "outline",
        synopsis: synopsis.trim(),
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
  };

  const { saveHistory } = useGenerationHistoryStore();

  const handleAccept = async () => {
    const editor = getEditorRef();
    if (!editor || !generatedText || !currentChapterId) return;
    editor.insertText(generatedText);
    await saveHistory({
      chapterId: currentChapterId,
      requestType: "outline",
      instruction: synopsis.trim(),
      content: generatedText,
      accepted: true,
    });
    onClose();
    reset();
  };

  const handleClose = () => {
    onClose();
    reset();
  };

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex h-[80vh] w-[90vw] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-panel-border bg-panel shadow-xl outline-none">
          <div className="flex items-center justify-between border-b border-panel-border px-4 py-3">
            <Dialog.Title className="text-sm font-medium">生成大纲</Dialog.Title>
            <Dialog.Close asChild>
              <button className="rounded p-1 text-muted-foreground hover:bg-muted">
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex flex-1 flex-col gap-3 overflow-hidden p-4">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">故事梗概</label>
              <textarea
                value={synopsis}
                onChange={(e) => setSynopsis(e.target.value)}
                placeholder="输入 100-500 字的故事梗概…"
                rows={5}
                className="w-full resize-none rounded-md bg-muted px-3 py-2 text-sm outline-none"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleGenerate}
                disabled={isGenerating || !synopsis.trim()}
                className="flex flex-1 items-center justify-center gap-1 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {isGenerating ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {isGenerating ? "生成中…" : "生成大纲"}
              </button>
            </div>

            {error && <div className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-500">{error}</div>}

            <div className="flex flex-1 flex-col overflow-hidden rounded-md border border-panel-border">
              <div className="border-b border-panel-border px-3 py-2 text-xs font-medium text-muted-foreground">生成结果</div>
              <div className="relative flex-1 overflow-auto p-3">
                {isGenerating && generatedText === "" && (
                  <div className="absolute inset-0 flex items-center justify-center bg-panel/80">
                    <Loader2 size={24} className="animate-spin text-primary" />
                  </div>
                )}
                <pre className="whitespace-pre-wrap text-sm">{generatedText || "大纲将显示在这里…"}</pre>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-panel-border px-4 py-3">
            <button
              onClick={handleClose}
              disabled={isGenerating}
              className="rounded-md bg-muted px-3 py-2 text-sm hover:bg-muted/80 disabled:opacity-50"
            >
              取消
            </button>
            <button
              onClick={handleAccept}
              disabled={isGenerating || !generatedText}
              className="rounded-md bg-green-600 px-3 py-2 text-sm text-white hover:bg-green-700 disabled:opacity-50"
            >
              插入到光标处
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
