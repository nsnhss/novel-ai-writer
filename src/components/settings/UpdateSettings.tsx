import { useState, useEffect } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { cn } from "@/lib/utils";

export function UpdateSettings() {
  const [version, setVersion] = useState<string>("");
  const [status, setStatus] = useState<"idle" | "checking" | "available" | "none" | "error">("idle");
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    // Tauri injects the app version at build time via __APP_VERSION__ in Vite,
    // but here we simply show a placeholder until the runtime API is available.
    setVersion(import.meta.env.VITE_APP_VERSION || "0.2.0");
  }, []);

  const handleCheck = async () => {
    setStatus("checking");
    setMessage("正在检查更新…");
    try {
      const update = await check();
      if (update) {
        setStatus("available");
        setMessage(`发现新版本 ${update.version}，请按提示安装。`);
        await update.downloadAndInstall((event) => {
          switch (event.event) {
            case "Started":
              setMessage(`开始下载更新包（共 ${event.data.contentLength ?? "未知"} 字节）…`);
              break;
            case "Progress":
              setMessage(`下载中… ${event.data.chunkLength} 字节`);
              break;
            case "Finished":
              setMessage("下载完成，即将安装并重启应用。");
              break;
          }
        });
      } else {
        setStatus("none");
        setMessage("当前已是最新版本。");
      }
    } catch (err) {
      setStatus("error");
      setMessage(`检查更新失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">关于</h3>
        <p className="text-xs text-muted-foreground">
          AI 小说写作 — 本地优先的 AI 辅助小说创作工具
        </p>
        <p className="text-xs text-muted-foreground">版本：{version}</p>
      </div>

      <div className="space-y-2">
        <button
          onClick={handleCheck}
          disabled={status === "checking"}
          className={cn(
            "rounded-md border px-3 py-2 text-sm transition-colors",
            status === "checking"
              ? "cursor-not-allowed opacity-60"
              : "hover:border-primary hover:text-primary"
          )}
        >
          {status === "checking" ? "检查中…" : "检查更新"}
        </button>
        {message && (
          <p
            className={cn(
              "text-xs",
              status === "error" && "text-destructive",
              status === "available" && "text-primary",
              status === "none" && "text-muted-foreground"
            )}
          >
            {message}
          </p>
        )}
      </div>

      <div className="rounded-md border border-border/50 p-3 text-xs text-muted-foreground">
        <p>本软件为个人写作辅助工具，运行在用户本地设备。</p>
        <ul className="mt-1 list-inside list-disc space-y-0.5">
          <li>所有数据存储在本地，不上传任何内容至第三方服务器</li>
          <li>用户对使用本软件创作的内容负全部责任</li>
          <li>请遵守所在地法律法规</li>
          <li>本软件仅供个人学习与创作使用</li>
        </ul>
      </div>
    </div>
  );
}
