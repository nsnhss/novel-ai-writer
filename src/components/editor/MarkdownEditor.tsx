import { useEffect, useRef, forwardRef, useImperativeHandle, useState, useCallback } from "react";
import { EditorView, keymap, placeholder as cmPlaceholder, Decoration } from "@codemirror/view";
import { EditorState, Compartment, EditorSelection } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { defaultKeymap, history, historyKeymap, undo, redo } from "@codemirror/commands";
import { search, searchKeymap, openSearchPanel } from "@codemirror/search";
import { Loader2, AlertTriangle, BookOpen } from "lucide-react";
import { useBookStore } from "@/stores/bookStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useGenerationStore } from "@/stores/generationStore";
import { setEditorRef } from "@/lib/editorRef";
import { buildEditorTheme } from "./codemirror-theme";
import { privacyMaskExtension } from "./privacyMask";
import { GenerationToolbar } from "./GenerationToolbar";

export interface MarkdownEditorHandle {
  getText: () => string;
  getSelection: () => string;
  getSelectionRange: () => { from: number; to: number; text: string };
  insertText: (text: string) => void;
  replaceSelection: (text: string) => void;
  replaceRange: (from: number, to: number, text: string) => void;
  appendText: (text: string) => void;
  setSelection: (from: number, to?: number) => void;
  startGeneration: () => number;
  appendGenerationToken: (token: string) => void;
  commitGeneration: () => void;
  rollbackGeneration: () => void;
  /** 中断/出错时收尾：保留已生成内容为待确认高亮（不 commit 也不回滚） */
  finishGeneration: () => void;
  focus: () => void;
  undo: () => void;
  redo: () => void;
  openSearch: () => void;
  saveNow: () => Promise<void>;
  /** 等待进行中的保存完成并确保未保存修改全部落库（切换章节前调用） */
  flushSave: () => Promise<void>;
}

interface MarkdownEditorProps {
  placeholder?: string;
  onSaveStateChange?: (state: { isSaving: boolean; hasUnsavedChanges: boolean }) => void;
  onWordCountChange?: (count: number) => void;
}

const themeCompartment = new Compartment();
const privacyCompartment = new Compartment();
const highlightCompartment = new Compartment();
const editableCompartment = new Compartment();

const pendingHighlightMark = Decoration.mark({ class: "cm-generation-pending" });

function pendingDecorations(range: { from: number; to: number } | null) {
  if (!range || range.to <= range.from) return [];
  return [pendingHighlightMark.range(range.from, range.to)];
}

function countWords(text: string): number {
  // 中文按字符计（含中文标点与全角符号，与主流写作软件口径一致）；英文按空格分词
  const chinese = (text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length;
  const english = text.replace(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g, ' ').split(/\s+/).filter(Boolean).length;
  return chinese + english;
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor({ placeholder = "开始写作…", onSaveStateChange, onWordCountChange }, ref) {
    const currentChapterId = useBookStore((s) => s.currentChapterId);
    const currentDocNode = useBookStore((s) => s.currentDocNode);
    const bookError = useBookStore((s) => s.error);
    const clearError = useBookStore((s) => s.clearError);
    const booksLoading = useBookStore((s) => s.isLoading);
    const { enabled: privacyEnabled, rules: privacyRules, loadRules, loadMode } = usePrivacyStore();
    const pendingRange = useGenerationStore((state) => state.pendingRange);
    const setPendingRange = useGenerationStore((state) => state.setPendingRange);
    const isGenerating = useGenerationStore((state) => state.isGenerating);
    const [hoverRange, setHoverRange] = useState(false);
    const [hoverToolbar, setHoverToolbar] = useState(false);
    const [toolbarCoords, setToolbarCoords] = useState<{ left: number; top: number } | null>(null);
    // 生成结束后工具条常驻显示，直到用户接受/拒绝（生成中为免跳动仅悬停显示）
    const toolbarVisible = pendingRange !== null && (hoverRange || hoverToolbar || !isGenerating);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const hasUnsavedChangesRef = useRef(false);
    const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const loadedChapterIdRef = useRef<string | null>(null);
    const isApplyingExternalChangeRef = useRef(false);
    const generationStartRef = useRef<number | null>(null);
    const generationEndRef = useRef<number | null>(null);
    const isGeneratingRef = useRef(false);
    const isSavingRef = useRef(false);
    const pendingTokensRef = useRef<string[]>([]);
    const flushTokensRef = useRef<number | null>(null);
    const pendingRangeRef = useRef<{ from: number; to: number } | null>(null);
    const flushRangeRef = useRef<number | null>(null);
    const wordCountTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const savePromiseRef = useRef<Promise<void> | null>(null);
    const userPinnedRef = useRef(true);

    const scheduleRangeUpdate = useCallback((range: { from: number; to: number } | null) => {
      pendingRangeRef.current = range;
      if (flushRangeRef.current !== null) return;
      flushRangeRef.current = requestAnimationFrame(() => {
        flushRangeRef.current = null;
        const r = pendingRangeRef.current;
        pendingRangeRef.current = null;
        if (r !== null) setPendingRange(r);
      });
    }, [setPendingRange]);

    const flushPendingTokens = useCallback(() => {
      flushTokensRef.current = null;
      const tokens = pendingTokensRef.current.join("");
      pendingTokensRef.current = [];
      if (tokens.length === 0) return;
      const v = viewRef.current;
      if (!v || !isGeneratingRef.current || generationEndRef.current === null) return;
      const p = generationEndRef.current;
      // 用户上滚回看时不强制拽回末尾；停在底部才跟随
      v.dispatch({ changes: { from: p, insert: tokens }, scrollIntoView: userPinnedRef.current });
      generationEndRef.current = p + tokens.length;
      scheduleRangeUpdate({ from: generationStartRef.current ?? p, to: generationEndRef.current });
    }, [scheduleRangeUpdate]);

    const scheduleTokenFlush = useCallback(() => {
      if (flushTokensRef.current !== null) return;
      flushTokensRef.current = requestAnimationFrame(flushPendingTokens);
    }, [flushPendingTokens]);

    const reportWordCount = useCallback((words: number) => {
      if (wordCountTimeoutRef.current) clearTimeout(wordCountTimeoutRef.current);
      wordCountTimeoutRef.current = setTimeout(() => {
        wordCountTimeoutRef.current = null;
        onWordCountChange?.(words);
      }, 150);
    }, [onWordCountChange]);

    const handle = useRef<MarkdownEditorHandle>({
      getText: () => viewRef.current?.state.doc.toString() ?? "",
      getSelection: () => { const v = viewRef.current; if (!v) return ""; const s = v.state.selection.main; return v.state.doc.sliceString(s.from, s.to); },
      getSelectionRange: () => { const v = viewRef.current; if (!v) return { from: 0, to: 0, text: "" }; const s = v.state.selection.main; return { from: s.from, to: s.to, text: v.state.doc.sliceString(s.from, s.to) }; },
      replaceRange: (from, to, text) => { const v = viewRef.current; if (!v) return; v.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, scrollIntoView: true }); v.focus(); },
      insertText: (t) => { const v = viewRef.current; if (!v) return; const p = v.state.selection.main.head; v.dispatch({ changes: { from: p, insert: t }, selection: { anchor: p + t.length }, scrollIntoView: true }); v.focus(); },
      replaceSelection: (t) => { const v = viewRef.current; if (!v) return; v.dispatch(v.state.replaceSelection(t)); v.focus(); },
      appendText: (t) => { const v = viewRef.current; if (!v) return; const d = v.state.doc; const p = d.length; const pre = p > 0 && !d.toString().endsWith("\n") ? "\n" : ""; v.dispatch({ changes: { from: p, insert: pre + t }, scrollIntoView: true }); },
      setSelection: (from, to) => { const v = viewRef.current; if (!v) return; const len = v.state.doc.length; const safeFrom = Math.max(0, Math.min(from, len)); const safeTo = Math.max(0, Math.min(to ?? safeFrom, len)); v.dispatch({ selection: EditorSelection.create([EditorSelection.range(safeFrom, safeTo)]), scrollIntoView: true }); v.focus(); },
      startGeneration: () => { const v = viewRef.current; if (!v) return 0; const p = v.state.selection.main.head; generationStartRef.current = p; generationEndRef.current = p; isGeneratingRef.current = true; userPinnedRef.current = true; setPendingRange({ from: p, to: p }); v.dispatch({ effects: editableCompartment.reconfigure(EditorView.editable.of(false)) }); return p; },
      appendGenerationToken: (t) => { if (!isGeneratingRef.current || generationEndRef.current === null) return; pendingTokensRef.current.push(t); scheduleTokenFlush(); },
      commitGeneration: () => {
        if (flushTokensRef.current !== null) {
          cancelAnimationFrame(flushTokensRef.current);
          flushTokensRef.current = null;
        }
        flushPendingTokens();
        isGeneratingRef.current = false;
        generationStartRef.current = null;
        generationEndRef.current = null;
        setPendingRange(null);
        viewRef.current?.dispatch({ effects: editableCompartment.reconfigure(EditorView.editable.of(true)) });
      },
      rollbackGeneration: () => {
        if (flushTokensRef.current !== null) {
          cancelAnimationFrame(flushTokensRef.current);
          flushTokensRef.current = null;
        }
        pendingTokensRef.current = [];
        const v = viewRef.current;
        if (v && generationStartRef.current !== null && generationEndRef.current !== null) {
          v.dispatch({ changes: { from: generationStartRef.current, to: generationEndRef.current, insert: "" } });
        }
        isGeneratingRef.current = false;
        generationStartRef.current = null;
        generationEndRef.current = null;
        setPendingRange(null);
        viewRef.current?.dispatch({ effects: editableCompartment.reconfigure(EditorView.editable.of(true)) });
      },
      finishGeneration: () => {
        if (flushTokensRef.current !== null) {
          cancelAnimationFrame(flushTokensRef.current);
          flushTokensRef.current = null;
        }
        flushPendingTokens();
        // 未生成任何内容时直接清除高亮，不显示工具条
        const empty =
          generationStartRef.current !== null &&
          generationEndRef.current !== null &&
          generationEndRef.current <= generationStartRef.current;
        isGeneratingRef.current = false;
        generationStartRef.current = null;
        generationEndRef.current = null;
        viewRef.current?.dispatch({ effects: editableCompartment.reconfigure(EditorView.editable.of(true)) });
        if (empty) setPendingRange(null);
      },
      focus: () => viewRef.current?.focus(),
      undo: () => { const v = viewRef.current; if (v) undo(v); },
      redo: () => { const v = viewRef.current; if (v) redo(v); },
      openSearch: () => { const v = viewRef.current; if (v) openSearchPanel(v); },
      saveNow: () => {
        // 已有保存在进行时直接复用同一个 Promise，调用方可等待落库完成
        if (isSavingRef.current && savePromiseRef.current) return savePromiseRef.current;
        const p = (async () => {
          const chapterId = useBookStore.getState().currentChapterId;
          if (!chapterId || isSavingRef.current || loadedChapterIdRef.current !== chapterId) return;
          const v = viewRef.current;
          if (!v) return;
          if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
          const text = v.state.doc.toString();
          isSavingRef.current = true;
          onSaveStateChange?.({ isSaving: true, hasUnsavedChanges: hasUnsavedChangesRef.current });
          try {
            await useBookStore.getState().saveChapter(chapterId, undefined, text);
            hasUnsavedChangesRef.current = false;
            onSaveStateChange?.({ isSaving: false, hasUnsavedChanges: false });
          } catch {
            onSaveStateChange?.({ isSaving: false, hasUnsavedChanges: true });
          } finally {
            isSavingRef.current = false;
          }
        })();
        savePromiseRef.current = p;
        return p;
      },
      flushSave: async () => {
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
          saveTimeoutRef.current = null;
        }
        // 进行中的保存完成后若又产生了新修改，最多再补存两轮
        for (let i = 0; i < 3 && hasUnsavedChangesRef.current; i++) {
          await handle.current.saveNow().catch(() => {});
        }
      },
    });

    useImperativeHandle(ref, () => handle.current);

    // Initialize CodeMirror once — container is always in DOM
    useEffect(() => {
      if (!containerRef.current || viewRef.current) return;

      const view = new EditorView({
        state: EditorState.create({
          doc: currentDocNode?.content ?? "",
          extensions: [
            history(),
            keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
            markdown(),
            // 写作者体验：超出一行宽度时软换行，禁止左右横移
            EditorView.lineWrapping,
            search({ top: true }),
            cmPlaceholder(placeholder),
            editableCompartment.of(EditorView.editable.of(true)),
            EditorView.domEventHandlers({
              scroll: (_event, v) => {
                const el = v.scrollDOM;
                userPinnedRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
              },
            }),
            themeCompartment.of(buildEditorTheme()),
            privacyCompartment.of(privacyMaskExtension(false, [])),
            highlightCompartment.of(EditorView.decorations.of(Decoration.set([]))),
            EditorView.theme({
              ".cm-generation-pending": {
                backgroundColor: "color-mix(in srgb, var(--accent) 12%, transparent)",
                borderBottom: "2px solid color-mix(in srgb, var(--accent) 45%, transparent)",
              },
            }),
            EditorView.updateListener.of((update) => {
              // Trigger save immediately when the editor loses focus and there are
              // pending changes (requirement: save on blur).
              if (update.focusChanged && !update.view.hasFocus && hasUnsavedChangesRef.current && !isSavingRef.current) {
                handle.current.saveNow();
                return;
              }

              if (!update.docChanged && !update.selectionSet) return;

              if (update.selectionSet && !isApplyingExternalChangeRef.current && !isGeneratingRef.current) {
                const chapterId = useBookStore.getState().currentChapterId;
                if (chapterId) {
                  const s = update.state.selection.main;
                  localStorage.setItem(`novelWriter:lastCursor:${chapterId}`, JSON.stringify({ from: s.from, to: s.to }));
                }
              }

              if (!update.docChanged) return;

              const text = update.state.doc.toString();
              const words = countWords(text);

              // Always report live word count, except when we ourselves are
              // injecting a chapter switch (avoids a double update).
              if (!isApplyingExternalChangeRef.current) {
                reportWordCount(words);
              }

              // Don't mark AI generation or external loads as user edits.
              if (isGeneratingRef.current || isApplyingExternalChangeRef.current) return;

              const wasUnsaved = hasUnsavedChangesRef.current;
              hasUnsavedChangesRef.current = true;
              if (!wasUnsaved) {
                onSaveStateChange?.({ isSaving: false, hasUnsavedChanges: true });
              }

              if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

              // 空闲 5 秒即自动保存（崩溃窗口最小化）；失焦/卸载另有即存兑底
              saveTimeoutRef.current = setTimeout(async () => {
                if (isSavingRef.current) return;  // skip if already saving
                const chapterId = useBookStore.getState().currentChapterId;
                if (!chapterId || loadedChapterIdRef.current !== chapterId) return;
                const view = viewRef.current;
                if (!view) return;
                const latestText = view.state.doc.toString();
                isSavingRef.current = true;
                onSaveStateChange?.({ isSaving: true, hasUnsavedChanges: true });
                try {
                  await useBookStore.getState().saveChapter(chapterId, undefined, latestText);
                  hasUnsavedChangesRef.current = false;
                  onSaveStateChange?.({ isSaving: false, hasUnsavedChanges: false });
                } catch {
                  onSaveStateChange?.({ isSaving: false, hasUnsavedChanges: true });
                } finally {
                  isSavingRef.current = false;
                }
              }, 5000);
            }),
          ],
        }),
        parent: containerRef.current,
      });

      viewRef.current = view;
      loadedChapterIdRef.current = currentChapterId;
      setEditorRef(handle.current);
      loadMode();
      loadRules();

      // Initialize word count if the editor was created with content already loaded.
      const initialText = currentDocNode?.content ?? "";
      if (initialText) {
        onWordCountChange?.(countWords(initialText));
      }

      return () => {
        view.destroy();
        viewRef.current = null;
        setEditorRef(null);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Load content when switching chapters
    useEffect(() => {
      const view = viewRef.current;
      if (!view || !currentChapterId || !currentDocNode) return;
      if (loadedChapterIdRef.current === currentChapterId) return;

      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

      isApplyingExternalChangeRef.current = true;
      try {
        const newText = currentDocNode.content ?? "";
        const currentText = view.state.doc.toString();
        if (currentText !== newText) {
          view.dispatch({
            changes: { from: 0, to: currentText.length, insert: newText },
            selection: { anchor: newText.length },
          });
        }

        // Restore the last known cursor position for this chapter.
        const savedCursor = localStorage.getItem(`novelWriter:lastCursor:${currentChapterId}`);
        if (savedCursor) {
          try {
            const { from, to } = JSON.parse(savedCursor) as { from: number; to: number };
            const len = newText.length;
            const safeFrom = Math.max(0, Math.min(from, len));
            const safeTo = Math.max(0, Math.min(to ?? safeFrom, len));
            view.dispatch({
              selection: EditorSelection.create([EditorSelection.range(safeFrom, safeTo)]),
              scrollIntoView: true,
            });
          } catch {
            // Ignore malformed saved cursor.
          }
        }

        hasUnsavedChangesRef.current = false;
        onSaveStateChange?.({ isSaving: false, hasUnsavedChanges: false });
        onWordCountChange?.(countWords(newText));
      } finally {
        isApplyingExternalChangeRef.current = false;
      }
      loadedChapterIdRef.current = currentChapterId;
      // 切换章节后焦点回到编辑器，可直接开始打字
      view.focus();
    }, [currentChapterId, currentDocNode, onSaveStateChange, onWordCountChange]);

    // Privacy mask
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({ effects: privacyCompartment.reconfigure(privacyMaskExtension(privacyEnabled, privacyRules)) });
    }, [privacyEnabled, privacyRules]);

    // Highlight pending generation range
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      const decos = Decoration.set(pendingDecorations(pendingRange));
      view.dispatch({ effects: highlightCompartment.reconfigure(EditorView.decorations.of(decos)) });
    }, [pendingRange]);

    // Save on app/window blur to avoid losing the last edit.
    useEffect(() => {
      const onWindowBlur = () => {
        if (hasUnsavedChangesRef.current && !isSavingRef.current) {
          handle.current.saveNow();
        }
      };
      window.addEventListener("blur", onWindowBlur);
      return () => {
        window.removeEventListener("blur", onWindowBlur);
      };
    }, []);

    // Cleanup timeout on unmount
    useEffect(() => {
      return () => {
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        // Best-effort save when the component unmounts (e.g. closing a book).
        if (hasUnsavedChangesRef.current && !isSavingRef.current) {
          handle.current.saveNow();
        }
      };
    }, []);

    const handleContainerMouseMove = useCallback(
      (e: React.MouseEvent) => {
        const v = viewRef.current;
        if (!v || !pendingRange) {
          setHoverRange(false);
          return;
        }
        const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
        setHoverRange(pos !== null && pos >= pendingRange.from && pos <= pendingRange.to);
      },
      [pendingRange]
    );

    const handleContainerMouseLeave = useCallback(() => setHoverRange(false), []);

    useEffect(() => {
      const v = viewRef.current;
      const wrapper = wrapperRef.current;
      if (!toolbarVisible || !pendingRange || !v || !wrapper) {
        setToolbarCoords(null);
        return;
      }
      const coords = v.coordsAtPos(pendingRange.to);
      if (!coords) {
        setToolbarCoords(null);
        return;
      }
      const rect = wrapper.getBoundingClientRect();
      setToolbarCoords({ left: coords.left - rect.left, top: coords.bottom - rect.top });
    }, [toolbarVisible, pendingRange]);

    return (
      <div
        ref={wrapperRef}
        className="relative h-full w-full overflow-hidden bg-background"
        onMouseMove={handleContainerMouseMove}
        onMouseLeave={handleContainerMouseLeave}
      >
        {/* 栏宽由 --editor-max-width 控制（设置-外观），不再固定 max-w-3xl */}
        <div className="h-full w-full">
          <div ref={containerRef} className="h-full w-full" />
        </div>
        {toolbarVisible && toolbarCoords && (
          <div
            className="absolute z-30"
            style={{ left: toolbarCoords.left, top: toolbarCoords.top }}
            onMouseEnter={() => setHoverToolbar(true)}
            onMouseLeave={() => setHoverToolbar(false)}
          >
            <GenerationToolbar />
          </div>
        )}
        {!currentChapterId && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background">
            {bookError ? (
              <div className="max-w-sm text-center">
                <AlertTriangle size={32} className="mx-auto mb-3 text-red-500" />
                <p className="text-sm text-red-500 mb-2">加载失败</p>
                <p className="text-xs text-muted-foreground mb-4 max-h-32 overflow-auto">{bookError}</p>
                <button onClick={clearError} className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90">重试</button>
              </div>
            ) : booksLoading ? (
              <div className="text-center text-muted-foreground">
                <Loader2 size={24} className="mx-auto mb-2 animate-spin" />
                正在加载章节…
              </div>
            ) : (
              /* 无章节空态：引导而非永久转圈 */
              <div className="text-center text-muted-foreground">
                <BookOpen size={36} className="mx-auto mb-3 opacity-60" />
                <p className="text-sm">从左侧选择一章，或新建章节开始写作</p>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }
);
