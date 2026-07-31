import { useRef, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/stores/uiStore";
import { SidebarLeft } from "./SidebarLeft";
import { SidebarRight } from "./SidebarRight";
import { StatusBar } from "./StatusBar";
import { TitleBar } from "./TitleBar";
import { MarkdownEditor } from "../editor/MarkdownEditor";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { RewriteDiffDialog } from "@/components/ai/RewriteDiffDialog";
import { BranchDialog } from "@/components/ai/BranchDialog";
import { Toaster } from "@/components/common/Toaster";
import { ConfirmDialogHost } from "@/components/ui/confirm-dialog";
import { PromptDialogHost } from "@/components/ui/prompt-dialog";
import { TooltipProvider } from "@/components/ui/tooltip";

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
    settingsOpen,
  } = useUIStore();

  const [liveWordCount, setLiveWordCount] = useState(0);
  const [saveState, setSaveState] = useState({ isSaving: false, hasUnsavedChanges: false });

  const wordCount = liveWordCount;

  return (
    <TooltipProvider>
    <div className="flex h-full w-full flex-col overflow-hidden">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
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

        {/* Left resizer（折叠按钮已上移至 TitleBar） */}
        {!leftSidebarCollapsed && (
          <div className="flex h-full flex-col items-center bg-sidebar">
            <Resizer onResize={(dx) => setLeftSidebarWidth(leftSidebarWidth + dx)} />
          </div>
        )}

        {/* Main editor（章节标题已进 TitleBar 面包屑，此处不再有头部栏） */}
        <div className="flex flex-1 flex-col bg-background">
          <div className="flex-1 overflow-hidden">
            <MarkdownEditor onSaveStateChange={setSaveState} onWordCountChange={setLiveWordCount} />
          </div>
          <StatusBar isSaving={saveState.isSaving} hasUnsavedChanges={saveState.hasUnsavedChanges} wordCount={wordCount} />
        </div>

        {/* Right resizer（折叠按钮已上移至 TitleBar） */}
        {!rightSidebarCollapsed && (
          <div className="flex h-full flex-col items-center bg-panel">
            <Resizer onResize={(dx) => setRightSidebarWidth(rightSidebarWidth - dx)} />
          </div>
        )}

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
      </div>
      <RewriteDiffDialog />
      <BranchDialog />
      <Toaster />
      <ConfirmDialogHost />
      <PromptDialogHost />
      {settingsOpen && <SettingsPage />}
    </div>
    </TooltipProvider>
  );
}
