// Promise 化确认对话框：替代 window.confirm，全局单例，由 <ConfirmDialogHost /> 挂载一次
import { useCallback, useEffect, useState } from "react";
import { Button } from "./button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";

export interface ConfirmDialogOptions {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

interface ConfirmRequest extends ConfirmDialogOptions {
  resolve: (ok: boolean) => void;
}

// 模块级单例状态 + 订阅者（参考 src/lib/toast.ts 的模式）
let current: ConfirmRequest | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 弹出确认对话框，用户确认 resolve(true)，取消/关闭 resolve(false) */
export function confirmDialog(opts: ConfirmDialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    // 已有未处理的请求时先以取消收尾，避免 Promise 泄漏
    current?.resolve(false);
    current = { ...opts, resolve };
    notify();
  });
}

function settle(ok: boolean) {
  const req = current;
  current = null;
  notify();
  req?.resolve(ok);
}

/** 确认对话框宿主：在 AppLayout 中挂载一次 */
export function ConfirmDialogHost() {
  const [, forceRender] = useState(0);
  const rerender = useCallback(() => forceRender((n) => n + 1), []);

  useEffect(() => subscribe(rerender), [rerender]);

  const req = current;
  if (!req) return null;

  return (
    <Dialog open onOpenChange={(open) => !open && settle(false)}>
      <DialogContent
        className="max-w-sm"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            settle(true);
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{req.title}</DialogTitle>
          {req.description && <DialogDescription>{req.description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => settle(false)}>
            {req.cancelText ?? "取消"}
          </Button>
          <Button
            variant={req.danger ? "destructive" : "default"}
            autoFocus
            onClick={() => settle(true)}
          >
            {req.confirmText ?? "确定"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
