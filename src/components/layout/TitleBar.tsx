import { useEffect } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Moon,
  PanelLeft,
  PanelRight,
  Plus,
  Settings,
  Sun,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { promptDialog } from "@/components/ui/prompt-dialog";
import { useBookStore } from "@/stores/bookStore";
import { useUIStore } from "@/stores/uiStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { toast } from "@/lib/toast";

export function TitleBar() {
  const { books, currentBookId, currentChapterId, volumes, loadBookTree, createBook } = useBookStore(
    useShallow((s) => ({
      books: s.books,
      currentBookId: s.currentBookId,
      currentChapterId: s.currentChapterId,
      volumes: s.volumes,
      loadBookTree: s.loadBookTree,
      createBook: s.createBook,
    }))
  );
  const {
    theme,
    setTheme,
    leftSidebarCollapsed,
    rightSidebarCollapsed,
    toggleLeftSidebar,
    toggleRightSidebar,
    setSettingsOpen,
  } = useUIStore();
  const { enabled: privacyEnabled, loadMode, toggleEnabled } = usePrivacyStore(
    useShallow((s) => ({ enabled: s.enabled, loadMode: s.loadMode, toggleEnabled: s.toggleEnabled }))
  );

  // 隐私开关从 StatusBar 上移，加载模式逻辑一并迁移
  useEffect(() => {
    loadMode();
  }, [loadMode]);

  const currentBook = books.find((b) => b.id === currentBookId);
  const currentVolume = volumes.find((v) => v.chapters?.some((c) => c.id === currentChapterId));
  const currentChapter = currentVolume?.chapters?.find((c) => c.id === currentChapterId);

  const handleCreateBook = async () => {
    const title = await promptDialog({
      title: "新建作品",
      placeholder: "请输入作品名称",
      confirmText: "创建",
    });
    if (!title?.trim()) return;
    try {
      await createBook(title.trim());
    } catch (err) {
      toast.error(`创建作品失败: ${String(err)}`);
    }
  };

  return (
    <div className="flex h-10 flex-shrink-0 items-center justify-between border-b border-border bg-background px-3">
      {/* 左：书籍切换 + 面包屑 */}
      <div className="flex min-w-0 items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="max-w-56 gap-1 px-2 font-medium">
              <span className="truncate">{currentBook?.title ?? "未选择作品"}</span>
              <ChevronDown size={14} className="flex-shrink-0 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {books.map((book) => (
              <DropdownMenuItem
                key={book.id}
                onClick={() => {
                  if (book.id !== currentBookId) void loadBookTree(book.id);
                }}
              >
                <span className="truncate">{book.title}</span>
                {book.id === currentBookId && <Check size={14} className="ml-auto text-accent" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void handleCreateBook()}>
              <Plus size={14} />
              新建作品
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {(currentVolume || currentChapter) && (
          <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            {currentVolume && <span className="truncate">{currentVolume.title}</span>}
            {currentVolume && currentChapter && <ChevronRight size={12} className="flex-shrink-0" />}
            {currentChapter && <span className="truncate">{currentChapter.title}</span>}
          </div>
        )}
      </div>

      {/* 右：全局操作 */}
      <div className="flex items-center gap-0.5">
        <Tooltip content={privacyEnabled ? "关闭隐私脱敏" : "开启隐私脱敏"} side="bottom">
          <Button variant="ghost" size="icon" title={privacyEnabled ? "关闭隐私脱敏" : "开启隐私脱敏"} onClick={toggleEnabled}>
            {privacyEnabled ? <EyeOff size={16} className="text-accent" /> : <Eye size={16} />}
          </Button>
        </Tooltip>
        <Tooltip content={theme === "dark" ? "切换为浅色主题" : "切换为深色主题"} side="bottom">
          <Button variant="ghost" size="icon" title={theme === "dark" ? "切换为浅色主题" : "切换为深色主题"} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </Button>
        </Tooltip>
        <Tooltip content={leftSidebarCollapsed ? "展开目录" : "收起目录"} side="bottom">
          <Button variant="ghost" size="icon" title={leftSidebarCollapsed ? "展开目录" : "收起目录"} onClick={toggleLeftSidebar}>
            <PanelLeft size={16} />
          </Button>
        </Tooltip>
        <Tooltip content={rightSidebarCollapsed ? "展开面板" : "收起面板"} side="bottom">
          <Button variant="ghost" size="icon" title={rightSidebarCollapsed ? "展开面板" : "收起面板"} onClick={toggleRightSidebar}>
            <PanelRight size={16} />
          </Button>
        </Tooltip>
        <Tooltip content="设置" side="bottom">
          <Button variant="ghost" size="icon" title="设置" onClick={() => setSettingsOpen(true)}>
            <Settings size={16} />
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}
