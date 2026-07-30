import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { onToast, type ToastType } from "@/lib/toast";

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

let nextId = 1;

/** 全局 toast 容器：挂载于应用根部，右下角弹出，4 秒自动消失 */
export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    return onToast(({ message, type }) => {
      const id = nextId++;
      setItems((prev) => [...prev.slice(-4), { id, message, type }]);
      setTimeout(() => {
        setItems((prev) => prev.filter((t) => t.id !== id));
      }, 4000);
    });
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-10 right-4 z-[100] flex w-80 flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className={cn(
            "pointer-events-auto flex items-start gap-2 rounded-md border p-3 text-xs shadow-lg whitespace-pre-wrap",
            t.type === "error" && "border-red-500/40 bg-red-500/10 text-red-500",
            t.type === "success" && "border-green-500/40 bg-green-500/10 text-green-600",
            t.type === "info" && "border-panel-border bg-panel text-foreground"
          )}
        >
          <span className="flex-1">{t.message}</span>
          <button
            onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
            className="flex-shrink-0 opacity-60 hover:opacity-100"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
