import { useState, useEffect, useMemo, useRef } from "react";
import {
  ChevronRight, ChevronDown, FileText, Folder, Plus, BookOpen, Loader2, AlertTriangle,
  FolderPlus, ChevronsUpDown, MoreHorizontal, GripVertical, Check, Pencil, ArrowUp, ArrowDown, Trash2,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import {
  DndContext, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { useBookStore, type Volume, type Chapter } from "@/stores/bookStore";
import { useUIStore } from "@/stores/uiStore";
import { getEditorRef } from "@/lib/editorRef";
import { ContextMenu } from "@/components/ui/context-menu";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { promptDialog } from "@/components/ui/prompt-dialog";

/** 当前处于行内重命名状态的节点 */
type RenameTarget = { kind: "volume" | "chapter"; id: string } | null;

/** dnd-kit sortable id 加前缀区分卷/章，防止 id 命名空间冲突 */
const volDragId = (id: string) => `vol:${id}`;
const chDragId = (id: string) => `ch:${id}`;

const nonEmptyTitle = (v: string) => (v.trim() ? null : "标题不能为空");

/** 行内重命名输入框：自动 focus+全选，Enter 提交 / Esc 或失焦取消 */
function RenameInput({ defaultValue, onSubmit, onCancel }: {
  defaultValue: string;
  onSubmit: (title: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  const submit = () => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== defaultValue) onSubmit(trimmed);
    else onCancel();
  };

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={onCancel}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          submit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      className="min-w-0 flex-1 rounded border border-accent bg-background px-1 py-0 text-sm outline-none"
    />
  );
}

/** 章节节点的菜单项（右键菜单与"更多"下拉共用） */
function ChapterMenuItems({ onRename, onMove, onDelete }: {
  onRename: () => void;
  onMove: (direction: "up" | "down") => void;
  onDelete: () => void;
}) {
  return (
    <>
      <DropdownMenuItem onSelect={onRename}>
        <Pencil size={14} className="mr-2" />重命名
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onMove("up")}>
        <ArrowUp size={14} className="mr-2" />上移
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onMove("down")}>
        <ArrowDown size={14} className="mr-2" />下移
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem danger onSelect={onDelete}>
        <Trash2 size={14} className="mr-2" />删除
      </DropdownMenuItem>
    </>
  );
}

/** 卷节点的菜单项（右键菜单与"更多"下拉共用） */
function VolumeMenuItems({ onRename, onCreateChapter, onMove, onDelete }: {
  onRename: () => void;
  onCreateChapter: () => void;
  onMove: (direction: "up" | "down") => void;
  onDelete: () => void;
}) {
  return (
    <>
      <DropdownMenuItem onSelect={onRename}>
        <Pencil size={14} className="mr-2" />重命名
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={onCreateChapter}>
        <Plus size={14} className="mr-2" />新建章节
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => onMove("up")}>
        <ArrowUp size={14} className="mr-2" />上移
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onMove("down")}>
        <ArrowDown size={14} className="mr-2" />下移
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem danger onSelect={onDelete}>
        <Trash2 size={14} className="mr-2" />删除
      </DropdownMenuItem>
    </>
  );
}

interface ChapterNodeProps {
  chapter: Chapter;
  isActive: boolean;
  isRenaming: boolean;
  onSelect: () => void;
  onStartRename: () => void;
  onSubmitRename: (title: string) => void;
  onCancelRename: () => void;
  onMove: (direction: "up" | "down") => void;
  onDelete: () => void;
}

function ChapterNode({ chapter, isActive, isRenaming, onSelect, onStartRename, onSubmitRename, onCancelRename, onMove, onDelete }: ChapterNodeProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: chDragId(chapter.id),
    disabled: isRenaming,
  });

  const menuItems = (
    <ChapterMenuItems onRename={onStartRename} onMove={onMove} onDelete={onDelete} />
  );

  const row = (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        paddingLeft: "20px",
        // 选中章节：左侧 2px accent 竖条
        boxShadow: isActive ? "inset 2px 0 0 var(--accent)" : undefined,
      }}
      className={cn(
        "group flex items-center gap-1 rounded px-2 py-1.5 text-sm cursor-pointer select-none",
        isActive ? "bg-muted" : "hover:bg-muted/50",
        isDragging && "relative z-10 opacity-80 bg-muted shadow-md"
      )}
      onClick={onSelect}
      {...attributes}
      {...listeners}
    >
      <GripVertical size={12} className="-ml-1 flex-shrink-0 text-muted-foreground opacity-0 group-hover:opacity-50" />
      <FileText size={14} className="mr-1 flex-shrink-0 text-muted-foreground" />
      {isRenaming ? (
        <RenameInput defaultValue={chapter.title} onSubmit={onSubmitRename} onCancel={onCancelRename} />
      ) : (
        <span
          className="truncate flex-1"
          onDoubleClick={(e) => {
            e.stopPropagation();
            onStartRename();
          }}
        >
          {chapter.title}
        </span>
      )}
      {!isRenaming && (
        <>
          <span className="text-xs mr-1 text-muted-foreground">{chapter.wordCount}</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-accent"
                title="更多操作"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal size={14} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
              {menuItems}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </div>
  );

  return <ContextMenu trigger={row}>{menuItems}</ContextMenu>;
}

interface VolumeNodeProps {
  volume: Volume;
  currentChapterId: string | null;
  renaming: RenameTarget;
  setRenaming: (target: RenameTarget) => void;
  onSelectChapter: (chapterId: string) => void;
  onCreateChapter: (volumeId: string) => void;
  onRenameVolume: (volumeId: string, title: string) => void;
  onMoveVolume: (volumeId: string, direction: "up" | "down") => void;
  onDeleteVolume: (volume: Volume) => void;
  onRenameChapter: (chapterId: string, title: string) => void;
  onMoveChapter: (volumeId: string, chapterId: string, direction: "up" | "down") => void;
  onDeleteChapter: (chapter: Chapter) => void;
}

function VolumeNode({ volume, currentChapterId, renaming, setRenaming, onSelectChapter, onCreateChapter, onRenameVolume, onMoveVolume, onDeleteVolume, onRenameChapter, onMoveChapter, onDeleteChapter }: VolumeNodeProps) {
  const expanded = useUIStore((s) => !s.collapsedVolumes[volume.id]);
  const toggleVolumeCollapsed = useUIStore((s) => s.toggleVolumeCollapsed);
  const chapters = useMemo(() => volume.chapters ?? [], [volume.chapters]);
  const isRenaming = renaming?.kind === "volume" && renaming.id === volume.id;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: volDragId(volume.id),
    disabled: isRenaming,
  });

  const menuItems = (
    <VolumeMenuItems
      onRename={() => setRenaming({ kind: "volume", id: volume.id })}
      onCreateChapter={() => onCreateChapter(volume.id)}
      onMove={(direction) => onMoveVolume(volume.id, direction)}
      onDelete={() => onDeleteVolume(volume)}
    />
  );

  const header = (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, paddingLeft: "8px" }}
      className={cn(
        "group flex items-center rounded px-2 py-1.5 text-sm select-none hover:bg-muted/50",
        isDragging && "relative z-10 opacity-80 bg-muted shadow-md"
      )}
      {...attributes}
      {...listeners}
    >
      <GripVertical size={12} className="-ml-1 mr-0.5 flex-shrink-0 text-muted-foreground opacity-0 group-hover:opacity-50" />
      <div
        className="flex items-center gap-1 flex-1 min-w-0 cursor-pointer"
        onClick={() => toggleVolumeCollapsed(volume.id)}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Folder size={14} className="mr-1 flex-shrink-0 text-muted-foreground" />
        {isRenaming ? (
          <RenameInput
            defaultValue={volume.title}
            onSubmit={(title) => {
              setRenaming(null);
              onRenameVolume(volume.id, title);
            }}
            onCancel={() => setRenaming(null)}
          />
        ) : (
          <span
            className="truncate"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setRenaming({ kind: "volume", id: volume.id });
            }}
          >
            {volume.title}
          </span>
        )}
      </div>
      {!isRenaming && (
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
          <button
            className="rounded p-0.5 hover:bg-accent"
            title="添加章节"
            onClick={(e) => {
              e.stopPropagation();
              onCreateChapter(volume.id);
            }}
          >
            <Plus size={12} />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="rounded p-0.5 hover:bg-accent"
                title="更多操作"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal size={12} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
              {menuItems}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );

  return (
    <div>
      <ContextMenu trigger={header}>{menuItems}</ContextMenu>
      {expanded && (
        <SortableContext items={chapters.map((c) => chDragId(c.id))} strategy={verticalListSortingStrategy}>
          <div>
            {chapters.map((chapter) => (
              <div key={chapter.id}>
                <ChapterNode
                  chapter={chapter}
                  isActive={currentChapterId === chapter.id}
                  isRenaming={renaming?.kind === "chapter" && renaming.id === chapter.id}
                  onSelect={() => onSelectChapter(chapter.id)}
                  onStartRename={() => setRenaming({ kind: "chapter", id: chapter.id })}
                  onSubmitRename={(title) => {
                    setRenaming(null);
                    onRenameChapter(chapter.id, title);
                  }}
                  onCancelRename={() => setRenaming(null)}
                  onMove={(direction) => onMoveChapter(volume.id, chapter.id, direction)}
                  onDelete={() => onDeleteChapter(chapter)}
                />
                <ChapterSections chapterId={chapter.id} />
              </div>
            ))}
          </div>
        </SortableContext>
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
    renameChapter, renameVolume, renameBook,
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
      renameChapter: s.renameChapter,
      renameVolume: s.renameVolume,
      renameBook: s.renameBook,
    }))
  );

  const [renaming, setRenaming] = useState<RenameTarget>(null);

  useEffect(() => { loadBooks(); }, [loadBooks]);

  const currentBook = books.find((b) => b.id === currentBookId);
  const bookTitle = currentBook?.title ?? "作品";

  // 拖拽：整行可拖，6px 位移阈值避免与点击打开章节/展开卷冲突
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const handleSwitchBook = async (bookId: string) => {
    if (bookId !== currentBookId) await loadBookTree(bookId);
  };

  const handleCreateBook = async () => {
    const title = await promptDialog({
      title: "新建作品",
      defaultValue: "新作品",
      placeholder: "作品标题",
      validate: nonEmptyTitle,
    });
    if (title?.trim()) await createBook(title.trim());
  };

  const handleRenameBook = async () => {
    if (!currentBook) return;
    const title = await promptDialog({
      title: "重命名作品",
      defaultValue: currentBook.title,
      placeholder: "作品标题",
      validate: nonEmptyTitle,
    });
    if (title?.trim() && title.trim() !== currentBook.title) {
      await renameBook(currentBook.id, title.trim());
    }
  };

  const handleDeleteBook = async () => {
    if (!currentBook) return;
    const ok = await confirmDialog({
      title: `删除「${currentBook.title}」`,
      description: "将删除该作品及其全部卷、章节内容，此操作不可恢复。",
      confirmText: "删除",
      danger: true,
    });
    if (ok) await deleteBook(currentBook.id);
  };

  const handleCreateVolume = async () => {
    if (!currentBookId) return;
    const title = await promptDialog({
      title: "新建卷",
      defaultValue: `第 ${volumes.length + 1} 卷`,
      placeholder: "卷标题",
      validate: nonEmptyTitle,
    });
    if (title?.trim()) await createVolume(currentBookId, title.trim());
  };

  const handleCreateChapter = async (volumeId: string) => {
    const title = await promptDialog({
      title: "新建章节",
      defaultValue: "新章节",
      placeholder: "章节标题",
      validate: nonEmptyTitle,
    });
    if (title?.trim()) await createChapter(volumeId, title.trim());
  };

  const handleDeleteVolume = async (volume: Volume) => {
    const ok = await confirmDialog({
      title: `删除卷「${volume.title}」`,
      description: `将删除该卷及其 ${(volume.chapters ?? []).length} 个章节，此操作不可恢复。`,
      confirmText: "删除",
      danger: true,
    });
    if (ok) await deleteVolume(volume.id);
  };

  const handleDeleteChapter = async (chapter: Chapter) => {
    const ok = await confirmDialog({
      title: `删除章节「${chapter.title}」`,
      description: "该章节内容将被永久删除，此操作不可恢复。",
      confirmText: "删除",
      danger: true,
    });
    if (ok) await deleteChapter(chapter.id);
  };

  const handleRenameChapter = async (chapterId: string, title: string) => {
    await renameChapter(chapterId, title);
  };

  const handleRenameVolume = async (volumeId: string, title: string) => {
    await renameVolume(volumeId, title);
  };

  /** 拖放落点后按 index 差值逐次调用 moveVolume/moveChapter 移动到目标位置 */
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    if (activeId.startsWith("vol:") && overId.startsWith("vol:")) {
      const volumeId = activeId.slice(4);
      const ids = volumes.map((v) => v.id);
      const from = ids.indexOf(volumeId);
      const to = ids.indexOf(overId.slice(4));
      if (from < 0 || to < 0 || from === to || !currentBookId) return;
      const direction = to > from ? ("down" as const) : ("up" as const);
      for (let i = 0; i < Math.abs(to - from); i++) {
        await moveVolume(currentBookId, volumeId, direction);
      }
      return;
    }

    if (activeId.startsWith("ch:") && overId.startsWith("ch:")) {
      const chapterId = activeId.slice(3);
      const overChapterId = overId.slice(3);
      const volume = volumes.find((v) => (v.chapters ?? []).some((c) => c.id === chapterId));
      if (!volume) return;
      const chapterIds = (volume.chapters ?? []).map((c) => c.id);
      // 仅支持卷内排序：落点必须是同一卷内的章节
      if (!chapterIds.includes(overChapterId)) return;
      const from = chapterIds.indexOf(chapterId);
      const to = chapterIds.indexOf(overChapterId);
      if (from < 0 || to < 0 || from === to) return;
      const direction = to > from ? ("down" as const) : ("up" as const);
      for (let i = 0; i < Math.abs(to - from); i++) {
        await moveChapter(volume.id, chapterId, direction);
      }
    }
  };

  const treeContent = isLoading ? (
    <div className="flex items-center justify-center py-8 text-muted-foreground">
      <Loader2 size={16} className="mr-2 animate-spin" />加载中…
    </div>
  ) : volumes.length === 0 ? (
    <div className="px-4 py-8 text-center text-sm text-muted-foreground">
      <BookOpen size={24} className="mx-auto mb-2 opacity-50" />
      <button onClick={handleCreateVolume} className="text-primary hover:underline">点击创建第一卷</button>
    </div>
  ) : (
    <SortableContext items={volumes.map((v) => volDragId(v.id))} strategy={verticalListSortingStrategy}>
      {volumes.map((volume) => (
        <VolumeNode
          key={volume.id}
          volume={volume}
          currentChapterId={currentChapterId}
          renaming={renaming}
          setRenaming={setRenaming}
          onSelectChapter={loadChapter}
          onCreateChapter={handleCreateChapter}
          onRenameVolume={handleRenameVolume}
          onMoveVolume={(volumeId, direction) => moveVolume(currentBookId ?? "", volumeId, direction)}
          onDeleteVolume={handleDeleteVolume}
          onRenameChapter={handleRenameChapter}
          onMoveChapter={(volumeId, chapterId, direction) => moveChapter(volumeId, chapterId, direction)}
          onDeleteChapter={handleDeleteChapter}
        />
      ))}
    </SortableContext>
  );

  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="border-b border-sidebar-border px-3 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center justify-between rounded px-2 py-1 text-sm hover:bg-muted">
              <span className="truncate font-medium">{bookTitle}</span>
              <ChevronsUpDown size={12} className="ml-1 flex-shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {books.map((book) => (
              <DropdownMenuItem key={book.id} onSelect={() => handleSwitchBook(book.id)}>
                <span className="mr-2 flex w-4 flex-shrink-0 items-center justify-center">
                  {book.id === currentBookId && <Check size={14} className="text-primary" />}
                </span>
                <BookOpen size={14} className="mr-2 flex-shrink-0" />
                <span className="truncate">{book.title}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleCreateBook}>
              <Plus size={14} className="mr-2" />新建作品
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={handleRenameBook} disabled={!currentBook}>
              <Pencil size={14} className="mr-2" />重命名本书
            </DropdownMenuItem>
            <DropdownMenuItem danger onSelect={handleDeleteBook} disabled={!currentBook}>
              <Trash2 size={14} className="mr-2" />删除本书
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

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

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <ContextMenu
          className="flex-1 overflow-y-auto py-2"
          trigger={
            <>
              {treeContent}
              {/* 底部留白，保证右键空白区可命中"新建卷" */}
              <div className="min-h-16" />
            </>
          }
        >
          <DropdownMenuItem onSelect={handleCreateVolume}>
            <FolderPlus size={14} className="mr-2" />新建卷
          </DropdownMenuItem>
        </ContextMenu>
      </DndContext>
    </div>
  );
}
