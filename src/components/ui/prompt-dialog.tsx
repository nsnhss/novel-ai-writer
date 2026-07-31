// Promise 化输入对话框：替代 window.prompt，全局单例，由 <PromptDialogHost /> 挂载一次
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "./button";
import { Input } from "./input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";

export interface PromptDialogOptions {
  title: string;
  description?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
  /** 返回错误字符串则阻止提交并显示红字；返回 null 表示通过 */
  validate?: (value: string) => string | null;
}

interface PromptRequest extends PromptDialogOptions {
  resolve: (value: string | null) => void;
}

// 模块级单例状态 + 订阅者（参考 src/lib/toast.ts 的模式）
let current: PromptRequest | null = null;
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

/** 弹出输入对话框，提交 resolve(输入值)，取消/关闭 resolve(null) */
export function promptDialog(opts: PromptDialogOptions): Promise<string | null> {
  return new Promise((resolve) => {
    current?.resolve(null);
    current = { ...opts, resolve };
    notify();
  });
}

function settle(value: string | null) {
  const req = current;
  current = null;
  notify();
  req?.resolve(value);
}

/** 输入对话框宿主：在 AppLayout 中挂载一次 */
export function PromptDialogHost() {
  const [, forceRender] = useState(0);
  const rerender = useCallback(() => forceRender((n) => n + 1), []);

  useEffect(() => subscribe(rerender), [rerender]);

  const req = current;
  if (!req) return null;
  // key 用于在每次新请求时重置内部输入状态
  return <PromptDialogInner key={req.title + String(req.defaultValue ?? "")} req={req} />;
}

function PromptDialogInner({ req }: { req: PromptRequest }) {
  const [value, setValue] = useState(req.defaultValue ?? "");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 自动聚焦并选中默认值
  useEffect(() => {
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  const submit = () => {
    const trimmed = value.trim();
    // 未提供 validate 时默认不允许提交空字符串
    const err = req.validate ? req.validate(value) : trimmed ? null : "内容不能为空";
    if (err) {
      setError(err);
      return;
    }
    settle(value);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && settle(null)}>
      <DialogContent
        className="max-w-sm"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{req.title}</DialogTitle>
          {req.description && <DialogDescription>{req.description}</DialogDescription>}
        </DialogHeader>
        <Input
          ref={inputRef}
          value={value}
          placeholder={req.placeholder}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
        />
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={() => settle(null)}>
            {req.cancelText ?? "取消"}
          </Button>
          <Button onClick={submit}>{req.confirmText ?? "确定"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
