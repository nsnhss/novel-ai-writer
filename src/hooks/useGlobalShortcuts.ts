import { useEffect } from "react";
import { useBookStore } from "@/stores/bookStore";
import { useUIStore } from "@/stores/uiStore";
import { useGenerationStore } from "@/stores/generationStore";
import { useShortcutStore, matchesShortcut, type ShortcutAction } from "@/stores/shortcutStore";
import { getEditorRef } from "@/lib/editorRef";

function isInputElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.dataset.shortcutInput) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

export function useGlobalShortcuts() {
  const { currentBookId, currentChapterId } = useBookStore();
  const { rightSidebarCollapsed, toggleRightSidebar } = useUIStore();
  const { startContinue, reset, params, openRewriteDialog } = useGenerationStore();
  const { shortcuts } = useShortcutStore();

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      // Ignore bare inputs; CodeMirror's contenteditable is allowed because
      // its shortcuts are editor-centric.
      if (isInputElement(event.target) && !(event.target as HTMLElement)?.classList.contains("cm-content")) {
        return;
      }

      const action = (Object.keys(shortcuts) as ShortcutAction[]).find((a) =>
        matchesShortcut(event, shortcuts[a])
      );

      if (!action) return;

      const editor = getEditorRef();
      if (!editor) return;

      // 只阻止默认行为，不阻断事件传播，避免劫持编辑器/其他组件的原生按键处理
      event.preventDefault();

      switch (action) {
        case "save": {
          if (!currentChapterId) return;
          editor.saveNow?.().catch(console.error);
          break;
        }
        case "continue": {
          if (!currentBookId || !currentChapterId) return;
          reset();
          editor.startGeneration();
          const text = editor.getText();
          startContinue(
            {
              bookId: currentBookId,
              chapterId: currentChapterId,
              cursorPrefix: text,
              ragQuery: text.slice(-200),
              requestType: "continue",
              temperature: params.temperature,
              topP: params.topP,
              maxTokens: params.maxTokens,
            },
            {
              onStart: () => {},
              onToken: (token) => editor.appendGenerationToken(token),
              onUsage: () => {},
              onError: () => editor.finishGeneration(),
              onDone: () => editor.commitGeneration(),
            }
          );
          break;
        }
        case "rewrite": {
          const range = editor.getSelectionRange();
          if (!range || range.text.length === 0) return;
          if (!currentBookId || !currentChapterId) return;
          const instruction = window.prompt("改写要求：", "保持原意，换一种表达方式") || "";
          if (!instruction.trim()) return;
          reset();
          openRewriteDialog({
            originalText: range.text,
            from: range.from,
            to: range.to,
            instruction,
          });
          break;
        }
        case "undo":
          editor.undo();
          break;
        case "redo":
          editor.redo();
          break;
        case "search":
          editor.openSearch();
          break;
        case "close_panel":
          if (!rightSidebarCollapsed) {
            toggleRightSidebar();
          }
          break;
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [
    currentBookId,
    currentChapterId,
    rightSidebarCollapsed,
    shortcuts,
    startContinue,
    toggleRightSidebar,
    reset,
    params,
  ]);
}
