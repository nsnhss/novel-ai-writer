import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { Shield, Database, HardDrive, FileText, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface EncryptionStatus {
  enabled: boolean;
  hasKey: boolean;
  cipherVersion?: string;
}

interface BackupInfo {
  date: string;
  path: string;
  size: number;
}

interface BackupStatus {
  enabled: boolean;
  retentionDays: number;
  lastBackupDate?: string;
  backups: BackupInfo[];
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function StoragePanel() {
  const [encryption, setEncryption] = useState<EncryptionStatus | null>(null);
  const [backup, setBackup] = useState<BackupStatus | null>(null);
  const [logDir, setLogDir] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const enc = await invoke<EncryptionStatus>("get_db_encryption_status");
      setEncryption(enc);
      const bak = await invoke<BackupStatus>("get_backup_status");
      setBackup(bak);
      const logs = await invoke<string>("get_log_directory");
      setLogDir(logs);
    } catch (err) {
      setMessage(`加载失败: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleEnableEncryption = async () => {
    if (passphrase.length < 6) {
      setMessage("口令长度至少 6 位");
      return;
    }
    if (passphrase !== confirmPassphrase) {
      setMessage("两次输入的口令不一致");
      return;
    }
    try {
      await invoke("enable_db_encryption", { passphrase });
      setMessage("加密已启用，重启应用后生效。请牢记口令，丢失将无法恢复数据。");
      setPassphrase("");
      setConfirmPassphrase("");
      await load();
    } catch (err) {
      setMessage(`启用加密失败: ${err}`);
    }
  };

  const handleDisableEncryption = async () => {
    try {
      await invoke("disable_db_encryption", { passphrase });
      setMessage("加密已关闭，重启应用后数据库将恢复为明文。");
      setPassphrase("");
      await load();
    } catch (err) {
      setMessage(`关闭加密失败: ${err}`);
    }
  };

  const toggleBackup = async (enabled: boolean) => {
    try {
      await invoke("set_backup_enabled", { enabled });
      await load();
    } catch (err) {
      setMessage(`设置失败: ${err}`);
    }
  };

  const setRetention = async (days: number) => {
    try {
      await invoke("set_backup_retention_days", { days });
      await load();
    } catch (err) {
      setMessage(`设置失败: ${err}`);
    }
  };

  const handleManualBackup = async () => {
    setLoading(true);
    try {
      const path = await invoke<string>("manual_backup_now");
      setMessage(`已创建备份: ${path}`);
      await load();
    } catch (err) {
      setMessage(`备份失败: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const openLogDir = async () => {
    if (logDir) await openPath(logDir);
  };

  return (
    <div className="space-y-5 text-sm">
      {message && (
        <div className="rounded-md bg-primary/10 p-2 text-xs text-primary">
          {message}
          <button
            onClick={() => setMessage(null)}
            className="ml-2 text-muted-foreground hover:text-foreground"
          >
            清除
          </button>
        </div>
      )}

      <div className="rounded-md border border-panel-border p-3">
        <div className="mb-3 flex items-center gap-2 font-medium">
          <Shield size={14} /> 数据库加密（SQLCipher）
        </div>
        {loading && !encryption ? (
          <div className="text-xs text-muted-foreground">加载中…</div>
        ) : encryption ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">当前状态</span>
              <span className={cn(encryption.enabled ? "text-green-500" : "text-muted-foreground")}>
                {encryption.enabled ? "已加密" : "未加密"}
              </span>
            </div>
            {encryption.cipherVersion && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">SQLCipher 版本</span>
                <span>{encryption.cipherVersion}</span>
              </div>
            )}

            {!encryption.enabled ? (
              <div className="space-y-2 pt-2">
                <input
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="设置加密口令（至少 6 位）"
                  className="w-full rounded-md bg-muted px-2 py-1.5 text-xs outline-none"
                />
                <input
                  type="password"
                  value={confirmPassphrase}
                  onChange={(e) => setConfirmPassphrase(e.target.value)}
                  placeholder="确认加密口令"
                  className="w-full rounded-md bg-muted px-2 py-1.5 text-xs outline-none"
                />
                <button
                  onClick={handleEnableEncryption}
                  className="w-full rounded-md bg-primary px-2 py-1.5 text-xs text-primary-foreground hover:opacity-90"
                >
                  启用数据库加密
                </button>
              </div>
            ) : (
              <div className="space-y-2 pt-2">
                <input
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="输入当前加密口令"
                  className="w-full rounded-md bg-muted px-2 py-1.5 text-xs outline-none"
                />
                <button
                  onClick={handleDisableEncryption}
                  className="w-full rounded-md bg-muted px-2 py-1.5 text-xs hover:bg-muted/80"
                >
                  关闭数据库加密
                </button>
              </div>
            )}
            <p className="text-[10px] text-muted-foreground">
              加密状态变更后需重启应用才会生效。口令仅保存在系统凭据管理器中。
            </p>
          </div>
        ) : null}
      </div>

      <div className="rounded-md border border-panel-border p-3">
        <div className="mb-3 flex items-center gap-2 font-medium">
          <Database size={14} /> 自动备份
        </div>
        {backup ? (
          <div className="space-y-3">
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={backup.enabled}
                onChange={(e) => toggleBackup(e.target.checked)}
                className="h-3 w-3"
              />
              启用每日自动备份
            </label>

            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">保留天数</span>
              <select
                value={backup.retentionDays}
                onChange={(e) => setRetention(Number(e.target.value))}
                disabled={!backup.enabled}
                className="rounded-md bg-muted px-2 py-1 outline-none disabled:opacity-50"
              >
                {[3, 7, 14, 30].map((d) => (
                  <option key={d} value={d}>
                    {d} 天
                  </option>
                ))}
              </select>
            </div>

            <div className="text-xs text-muted-foreground">
              上次备份: {backup.lastBackupDate ?? "无"}
            </div>

            <button
              onClick={handleManualBackup}
              disabled={loading}
              className="flex w-full items-center justify-center gap-1 rounded-md bg-muted px-2 py-1.5 text-xs hover:bg-muted/80 disabled:opacity-50"
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : <HardDrive size={12} />}
              立即备份
            </button>

            {backup.backups.length > 0 && (
              <div className="max-h-40 overflow-auto rounded bg-muted/50 p-2">
                <div className="mb-1 text-[10px] font-medium text-muted-foreground">备份列表</div>
                {backup.backups.map((b) => (
                  <div key={b.date} className="flex items-center justify-between py-0.5 text-[10px]">
                    <span>{b.date}</span>
                    <span className="text-muted-foreground">{formatBytes(b.size)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">加载中…</div>
        )}
      </div>

      <div className="rounded-md border border-panel-border p-3">
        <div className="mb-3 flex items-center gap-2 font-medium">
          <FileText size={14} /> 日志
        </div>
        <div className="space-y-2 text-xs">
          <div className="break-all text-muted-foreground">目录: {logDir || "加载中…"}</div>
          <button
            onClick={openLogDir}
            disabled={!logDir}
            className="flex w-full items-center justify-center gap-1 rounded-md bg-muted px-2 py-1.5 hover:bg-muted/80 disabled:opacity-50"
          >
            打开日志文件夹
          </button>
          <p className="text-[10px] text-muted-foreground">
            使用 <code>--debug</code> 启动应用可输出更多调试日志。
          </p>
        </div>
      </div>
    </div>
  );
}
