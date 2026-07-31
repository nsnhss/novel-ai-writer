// 右键菜单：基于 dropdown-menu 实现，在鼠标坐标处弹出（虚拟锚点技巧）
import { useRef, useState, type ReactNode, type MouseEvent } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "./dropdown-menu";

export interface ContextMenuProps {
  /** 触发区域：在其上点击右键弹出菜单 */
  trigger: ReactNode;
  /** 菜单项（DropdownMenuItem 等） */
  children: ReactNode;
  className?: string;
}

/**
 * 右键菜单容器：监听 trigger 区域的 onContextMenu，
 * 用一个固定定位的 1px 虚拟元素作为 DropdownMenu 的锚点，在鼠标处弹出。
 */
export function ContextMenu({ trigger, children, className }: ContextMenuProps) {
  const [open, setOpen] = useState(false);
  const [point, setPoint] = useState({ x: 0, y: 0 });
  const anchorRef = useRef<HTMLSpanElement>(null);

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    // 嵌套 ContextMenu 时（如树节点内的菜单 vs 面板空白区菜单）只触发最内层
    e.stopPropagation();
    setPoint({ x: e.clientX, y: e.clientY });
    // 等虚拟锚点定位完成后再打开菜单
    requestAnimationFrame(() => setOpen(true));
  };

  return (
    <div className={className} onContextMenu={handleContextMenu}>
      {trigger}
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <span
            ref={anchorRef}
            className="fixed h-px w-px"
            style={{ left: point.x, top: point.y }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent>{children}</DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
