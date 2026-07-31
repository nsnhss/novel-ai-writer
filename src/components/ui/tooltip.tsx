// 悬浮提示：封装 @radix-ui/react-tooltip，提供便捷的 <Tooltip content="..."> 用法
import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

const TooltipProvider = TooltipPrimitive.Provider;

export interface TooltipProps {
  /** 提示内容 */
  content: React.ReactNode;
  /** 弹出方向，默认 top */
  side?: "top" | "right" | "bottom" | "left";
  children: React.ReactNode;
  className?: string;
}

/** 便捷悬浮提示：children 作为触发器，需可接收 ref（原生元素或 forwardRef 组件） */
export function Tooltip({ content, side = "top", children, className }: TooltipProps) {
  return (
    <TooltipPrimitive.Root delayDuration={300}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={4}
          className={cn(
            "z-50 rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow",
            className
          )}
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export { TooltipProvider };
