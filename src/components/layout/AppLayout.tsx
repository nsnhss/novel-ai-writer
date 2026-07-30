import { useRef, useEffect, useState } from "react";
import { PanelLeft, PanelRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useShallow } from "zustand/react/shallow";
import { useUIStore } from "@/stores/uiStore";
import { useBookStore } from "@/stores/bookStore";
import { SidebarLeft } from "./SidebarLeft";
import { SidebarRight } from "./SidebarRight";
import { StatusBar } from "./StatusBar";
import { MarkdownEditor } from "../editor/MarkdownEditor";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { RewriteDiffDialog } from "@/components/ai/RewriteDiffDialog";
import { BranchDialog } from "@/components/ai/BranchDialog";
import { Toaster } from "@/components/common/Toaster";

function Resizer({
  onResize,
  className,
}: {
  onResize: (delta: number) => void;
  className?: string;
}) {
  const isDragging = useRef(false);
  const lastX = useRef(0);

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (!isDragging.current) return;
      // 用 clientX 差值代替 movementX，避免高 DPI/多显示器下的跳变
      const dx = e.clientX - lastX.current;
      lastX.current = e.clientX;
      if (dx !== 0) onResize(dx);
    }
    function handleMouseUp() {
      isDragging.current = false;
      document.body.style.cursor = "";
      (document.body.style as unknown as { userSelect: string }).userSelect = "";
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [onResize]);

  return (
    <div
      className={cn("resizer", className)}
      onMouseDown={(e) => {
        isDragging.current = true;
        lastX.current = e.clientX;
        document.body.style.cursor = "col-resize";
        (document.body.style as unknown as { userSelect: string }).userSelect = "none";
      }}
    />
  );
}

export function AppLayout() {
  useGlobalShortcuts();

  const {
    leftSidebarWidth,
    rightSidebarWidth,
    leftSidebarCollapsed,
    rightSidebarCollapsed,
    setLeftSidebarWidth,
    setRightSidebarWidth,
    toggleLeftSidebar,
    toggleRightSidebar,
  } = useUIStore();

  const currentChapterId = useBookStore((s) => s.currentChapterId);
  const volumes = useBookStore(useShallow((s) => s.volumes));
  const [liveWordCount, setLiveWordCount] = useState(0);
  const [saveState, setSaveState] = useState({ isSaving: false, hasUnsavedChanges: false });

  const currentVolume = volumes.find((v) => v.chapters?.some((c) => c.id === currentChapterId));
  const currentChapter = currentVolume?.chapters?.find((c) => c.id === currentChapterId);

  const wordCount = liveWordCount;

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Left sidebar */}
      <div
        className={cn(
          "flex-shrink-0 overflow-hidden transition-all duration-200",
          leftSidebarCollapsed ? "w-0 opacity-0" : "opacity-100"
        )}
        style={{ width: leftSidebarCollapsed ? 0 : leftSidebarWidth }}
      >
        <SidebarLeft />
      </div>

      {/* Left resizer / toggle */}
      <div className="flex h-full flex-col items-center bg-sidebar">
        {!leftSidebarCollapsed && <Resizer onResize={(dx) => setLeftSidebarWidth(leftSidebarWidth + dx)} />}
        <button
          onClick={toggleLeftSidebar}
          className="mt-2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          title={leftSidebarCollapsed ? "展开目录" : "收起目录"}
        >
          <PanelLeft size={16} />
        </button>
      </div>

      {/* Main editor */}
      <div className="flex flex-1 flex-col bg-background">
        <div className="flex items-center justify-between border-b border-panel-border px-4 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="truncate text-sm font-medium">{currentChapter?.title ?? "未选择章节"}</span>
            {currentVolume && (
              <span className="truncate text-xs text-muted-foreground">
                {currentVolume.title}
              </span>
            )}
          </div>
          {/* 字数统一在 StatusBar 显示，此处不再重复 */}
        </div>
        <div className="flex-1 overflow-hidden">
          <MarkdownEditor onSaveStateChange={setSaveState} onWordCountChange={setLiveWordCount} />
        </div>
        <StatusBar isSaving={saveState.isSaving} hasUnsavedChanges={saveState.hasUnsavedChanges} wordCount={wordCount} />
      </div>

      {/* Right resizer / toggle */}
      <div className="flex h-full flex-col items-center bg-panel">
        {!rightSidebarCollapsed && <Resizer onResize={(dx) => setRightSidebarWidth(rightSidebarWidth - dx)} />}
        <button
          onClick={toggleRightSidebar}
          className="mt-2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          title={rightSidebarCollapsed ? "展开面板" : "收起面板"}
        >
          <PanelRight size={16} />
        </button>
      </div>

      {/* Right sidebar */}
      <div
        className={cn(
          "flex-shrink-0 overflow-hidden transition-all duration-200",
          rightSidebarCollapsed ? "w-0 opacity-0" : "opacity-100"
        )}
        style={{ width: rightSidebarCollapsed ? 0 : rightSidebarWidth }}
      >
        <SidebarRight />
      </div>
      <RewriteDiffDialog />
      <BranchDialog />
      <Toaster />
    </div>
  );
}
