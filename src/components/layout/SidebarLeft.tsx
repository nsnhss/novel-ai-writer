import { useState, useEffect, useMemo } from "react";
import { ChevronRight, ChevronDown, FileText, Folder, Plus, Trash2, BookOpen, Loader2, AlertTriangle, FolderPlus, ChevronsUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { cn } from "@/lib/utils";
import { useBookStore, type Volume, type Chapter } from "@/stores/bookStore";
import { getEditorRef } from "@/lib/editorRef";

interface TreeNodeProps {
  volume: Volume;
  currentChapterId: string | null;
  onSelectChapter: (chapterId: string) => void;
  onCreateChapter: (volumeId: string) => void;
  onDeleteVolume: (volumeId: string) => void;
  onDeleteChapter: (chapterId: string) => void;
  onMoveVolume: (volumeId: string, direction: "up" | "down") => void;
  onMoveChapter: (volumeId: string, chapterId: string, direction: "up" | "down") => void;
}

interface ChapterNodeProps {
  chapter: Chapter;
  depth: number;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onMove: (direction: "up" | "down") => void;
}

function VolumeNode({ volume, currentChapterId, onSelectChapter, onCreateChapter, onDeleteVolume, onDeleteChapter, onMoveVolume, onMoveChapter }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const chapters = volume.chapters ?? [];

  return (
    <div>
      <div className="group flex items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-muted select-none">
        <div
          className="flex items-center gap-1 flex-1 min-w-0 cursor-pointer"
          onClick={() => setExpanded((prev) => !prev)}
          style={{ paddingLeft: "8px" }}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Folder size={14} className="mr-1 text-muted-foreground" />
          <span className="truncate">{volume.title}</span>
        </div>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
          <button className="rounded p-0.5 hover:bg-accent" title="上移" onClick={(e) => { e.stopPropagation(); onMoveVolume(volume.id, "up"); }}>
            <ArrowUp size={12} />
          </button>
          <button className="rounded p-0.5 hover:bg-accent" title="下移" onClick={(e) => { e.stopPropagation(); onMoveVolume(volume.id, "down"); }}>
            <ArrowDown size={12} />
          </button>
          <button className="rounded p-0.5 hover:bg-accent" title="添加章节" onClick={(e) => { e.stopPropagation(); onCreateChapter(volume.id); }}>
            <Plus size={12} />
          </button>
          <button className="rounded p-0.5 hover:bg-red-500/20 hover:text-red-500" title="删除卷" onClick={(e) => {
            e.stopPropagation();
            if (window.confirm("确定要删除此卷及其所有章节吗？")) onDeleteVolume(volume.id);
          }}>
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      {expanded && (
        <div>
          {chapters.map((chapter) => (
            <div key={chapter.id}>
              <ChapterNode chapter={chapter} depth={1} isActive={currentChapterId === chapter.id}
                onSelect={() => onSelectChapter(chapter.id)}
                onDelete={() => onDeleteChapter(chapter.id)}
                onMove={(direction) => onMoveChapter(volume.id, chapter.id, direction)}
              />
              <ChapterSections chapterId={chapter.id} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function parseHeadings(content: string) {
  const headings: { level: number; title: string; pos: number }[] = [];
  let pos = 0;
  for (const line of content.split("\n")) {
    const match = line.match(/^(#{1,6})\s+(.*)$/);
    if (match) {
      headings.push({ level: match[1].length, title: match[2].trim(), pos });
    }
    pos += line.length + 1;
  }
  return headings;
}

function SectionNode({ level, title, pos }: { level: number; title: string; pos: number }) {
  return (
    <div
      className="group flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
      style={{ paddingLeft: `${(level + 1) * 12 + 8}px` }}
      onClick={(e) => {
        e.stopPropagation();
        getEditorRef()?.setSelection(pos);
      }}
      title={title}
    >
      <span className="w-3.5" />
      <span className="truncate">{title}</span>
    </div>
  );
}

function ChapterNode({ chapter, depth, isActive, onSelect, onDelete, onMove }: ChapterNodeProps) {
  return (
    <div
      className={cn("group flex items-center gap-1 rounded px-2 py-1.5 text-sm cursor-pointer select-none", isActive ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      onClick={onSelect}
    >
      <span className="w-3.5" />
      <FileText size={14} className={cn("mr-1", isActive ? "text-primary-foreground" : "text-muted-foreground")} />
      <span className="truncate flex-1">{chapter.title}</span>
      <span className={cn("text-xs mr-1", isActive ? "text-primary-foreground/70" : "text-muted-foreground")}>{chapter.wordCount}</span>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
        <button className={cn("rounded p-0.5", isActive ? "hover:bg-primary-foreground/20" : "hover:bg-accent")}
          title="上移" onClick={(e) => { e.stopPropagation(); onMove("up"); }}>
          <ArrowUp size={12} />
        </button>
        <button className={cn("rounded p-0.5", isActive ? "hover:bg-primary-foreground/20" : "hover:bg-accent")}
          title="下移" onClick={(e) => { e.stopPropagation(); onMove("down"); }}>
          <ArrowDown size={12} />
        </button>
        <button className={cn("rounded p-0.5", isActive ? "hover:bg-primary-foreground/20" : "hover:bg-red-500/20 hover:text-red-500")}
          title="删除章节" onClick={(e) => { e.stopPropagation(); if (window.confirm("确定要删除此章节吗？")) onDelete(); }}>
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

function ChapterSections({ chapterId }: { chapterId: string }) {
  const currentChapterId = useBookStore((s) => s.currentChapterId);
  const currentDocNode = useBookStore((s) => s.currentDocNode);
  const isCurrent = currentChapterId === chapterId;
  const content = isCurrent ? currentDocNode?.content : undefined;
  // 仅当前章节渲染大纲；解析结果 memo，避免每次渲染全文 split
  const headings = useMemo(() => (content ? parseHeadings(content) : []), [content]);
  if (!isCurrent || headings.length === 0) return null;
  return (
    <>
      {headings.map((h, idx) => (
        <SectionNode key={idx} level={h.level} title={h.title} pos={h.pos} />
      ))}
    </>
  );
}

export function SidebarLeft() {
  const books = useBookStore(useShallow((s) => s.books));
  const volumes = useBookStore(useShallow((s) => s.volumes));
  const currentBookId = useBookStore((s) => s.currentBookId);
  const currentChapterId = useBookStore((s) => s.currentChapterId);
  const isLoading = useBookStore((s) => s.isLoading);
  const error = useBookStore((s) => s.error);
  const {
    loadBooks, loadBookTree, loadChapter, createBook, createVolume, createChapter,
    deleteVolume, deleteChapter, deleteBook, moveVolume, moveChapter, clearError,
  } = useBookStore(
    useShallow((s) => ({
      loadBooks: s.loadBooks,
      loadBookTree: s.loadBookTree,
      loadChapter: s.loadChapter,
      createBook: s.createBook,
      createVolume: s.createVolume,
      createChapter: s.createChapter,
      deleteVolume: s.deleteVolume,
      deleteChapter: s.deleteChapter,
      deleteBook: s.deleteBook,
      moveVolume: s.moveVolume,
      moveChapter: s.moveChapter,
      clearError: s.clearError,
    }))
  );

  const [showBookMenu, setShowBookMenu] = useState(false);

  useEffect(() => { loadBooks(); }, [loadBooks]);

  const currentBook = books.find((b) => b.id === currentBookId);
  const bookTitle = currentBook?.title ?? "作品";

  const handleSwitchBook = async (bookId: string) => { await loadBookTree(bookId); setShowBookMenu(false); };
  const handleCreateBook = async () => {
    const title = window.prompt("作品标题：", "新作品");
    if (title?.trim()) { await createBook(title.trim()); setShowBookMenu(false); }
  };
  const handleCreateVolume = async () => {
    if (!currentBookId) return;
    const title = window.prompt("卷标题：", `第 ${volumes.length + 1} 卷`);
    if (title?.trim()) await createVolume(currentBookId, title.trim());
  };
  const handleCreateChapter = async (volumeId: string) => {
    const title = window.prompt("章节标题：", "新章节");
    if (title?.trim()) await createChapter(volumeId, title.trim());
  };

  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="border-b border-sidebar-border px-3 py-2">
        <div className="relative">
          <button
            className="flex w-full items-center justify-between rounded px-2 py-1 text-sm hover:bg-muted"
            onClick={() => setShowBookMenu((prev) => !prev)}
          >
            <span className="truncate font-medium">{bookTitle}</span>
            <ChevronsUpDown size={12} className="ml-1 flex-shrink-0 text-muted-foreground" />
          </button>

          {showBookMenu && (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border bg-popover p-1 shadow-lg">
              {books.map((book) => (
                <div key={book.id}
                  className={cn("group flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm cursor-pointer",
                    book.id === currentBookId ? "bg-primary/10 text-primary" : "hover:bg-muted")}
                  onClick={() => handleSwitchBook(book.id)}
                >
                  <BookOpen size={14} />
                  <span className="truncate flex-1 text-left">{book.title}</span>
                  {book.id === currentBookId && <span className="text-xs text-primary">当前</span>}
                  <button
                    className="ml-auto flex-shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-red-500/20"
                    title={`删除「${book.title}」`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(`确定要删除「${book.title}」吗？此操作不可撤销。`)) {
                        deleteBook(book.id);
                        setShowBookMenu(false);
                      }
                    }}
                  >
                    <Trash2 size={14} className="text-red-500" />
                  </button>
                </div>
              ))}
              <div className="my-1 border-t" />
              <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted" onClick={handleCreateBook}>
                <Plus size={14} /><span>新建作品</span>
              </button>
            </div>
          )}
        </div>

        <div className="mt-1.5 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{volumes.length} 卷</span>
          <button className="rounded p-1 hover:bg-muted" title="新建卷" onClick={handleCreateVolume}>
            <FolderPlus size={14} />
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-2 mt-2 flex items-start gap-2 rounded border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-500">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={clearError} className="flex-shrink-0 text-red-400 hover:text-red-300">x</button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground"><Loader2 size={16} className="mr-2 animate-spin" />加载中…</div>
        ) : volumes.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            <BookOpen size={24} className="mx-auto mb-2 opacity-50" />
            <button onClick={handleCreateVolume} className="text-primary hover:underline">点击创建第一卷</button>
          </div>
        ) : (
          volumes.map((volume) => (
            <VolumeNode key={volume.id} volume={volume} currentChapterId={currentChapterId}
              onSelectChapter={loadChapter} onCreateChapter={handleCreateChapter}
              onDeleteVolume={deleteVolume} onDeleteChapter={deleteChapter}
              onMoveVolume={(volumeId, direction) => moveVolume(currentBookId ?? "", volumeId, direction)}
              onMoveChapter={(volumeId, chapterId, direction) => moveChapter(volumeId, chapterId, direction)}
            />
          ))
        )}
      </div>
    </div>
  );
}
