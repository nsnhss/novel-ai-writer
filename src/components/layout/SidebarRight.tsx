import {
  Bot,
  Search,
  LayoutTemplate,
  UserRound,
  MapPin,
  Anchor,
  Palette,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUIStore, type RightPanelTab } from "@/stores/uiStore";
import { SceneTemplatePanel } from "@/components/templates/SceneTemplatePanel";
import { CharacterPanel } from "@/components/characters/CharacterPanel";
import { ScenePanel } from "@/components/scenes/ScenePanel";
import { AnchorPanel } from "@/components/anchors/AnchorPanel";
import { MaterialPanel } from "@/components/materials/MaterialPanel";
import { StyleProfilePanel } from "@/components/styleProfile/StyleProfilePanel";
import { AIPanel } from "@/components/ai/panel/AIPanel";

const tabs: { id: RightPanelTab; label: string; icon: LucideIcon }[] = [
  { id: "ai", label: "AI", icon: Bot },
  { id: "material", label: "素材", icon: Search },
  { id: "template", label: "模板", icon: LayoutTemplate },
  { id: "character", label: "角色", icon: UserRound },
  { id: "scene", label: "场景", icon: MapPin },
  { id: "anchor", label: "锚点", icon: Anchor },
  { id: "styleProfile", label: "风格", icon: Palette },
];

export function SidebarRight() {
  const { rightPanelTab, setRightPanelTab } = useUIStore();

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex flex-wrap border-b border-panel-border">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setRightPanelTab(tab.id)}
              className={cn(
                "flex flex-1 basis-[4.5rem] items-center justify-center gap-1.5 border-b-2 px-2 py-2 text-xs transition-colors",
                rightPanelTab === tab.id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          );
        })}
      </div>
      <div className="flex-1 overflow-hidden">
        {/* 所有面板保持挂载（keep-alive）：切换 tab 不丢失面板内状态（生成状态、编辑草稿等） */}
        <div className={cn("h-full", rightPanelTab !== "ai" && "hidden")}>
          <AIPanel />
        </div>
        <div className={cn("h-full", rightPanelTab !== "material" && "hidden")}>
          <MaterialPanel />
        </div>
        <div className={cn("h-full", rightPanelTab !== "template" && "hidden")}>
          <SceneTemplatePanel />
        </div>
        <div className={cn("h-full", rightPanelTab !== "character" && "hidden")}>
          <CharacterPanel />
        </div>
        <div className={cn("h-full", rightPanelTab !== "scene" && "hidden")}>
          <ScenePanel />
        </div>
        <div className={cn("h-full", rightPanelTab !== "anchor" && "hidden")}>
          <AnchorPanel />
        </div>
        <div className={cn("h-full", rightPanelTab !== "styleProfile" && "hidden")}>
          <StyleProfilePanel />
        </div>
        {/* 设置已移出侧栏，由顶栏齿轮打开全屏设置页 */}
      </div>
    </div>
  );
}
