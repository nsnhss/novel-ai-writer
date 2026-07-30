import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { Upload, Package, Tags, Film, SlidersHorizontal, UserCircle, Stethoscope } from "lucide-react";

interface ImportSummary {
  name: string;
  version: string;
  contentLevelsAdded: number;
  tagsAdded: number;
  sceneTemplatesAdded: number;
  sliderPresetsAdded: number;
  schemaFieldsAdded: number;
  diagnosticDimensionsAdded: number;
}

interface InstalledExtension {
  name: string;
  version: string;
  importedAt: string;
}

export function ExtensionSettings() {
  const [installed, setInstalled] = useState<InstalledExtension[]>([]);
  const [lastResult, setLastResult] = useState<ImportSummary | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadInstalled();
  }, []);

  const loadInstalled = async () => {
    try {
      const list = await invoke<InstalledExtension[]>("list_installed_extensions");
      setInstalled(list);
    } catch (err) {
      console.error("加载扩展包失败:", err);
    }
  };

  const handleImport = async () => {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!selected || typeof selected !== "string") return;

    setIsImporting(true);
    setError(null);
    setLastResult(null);
    try {
      const result = await invoke<ImportSummary>("import_extension_package", { filePath: selected });
      setLastResult(result);
      await loadInstalled();
    } catch (err) {
      setError(String(err));
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">扩展包</h3>
        <button
          onClick={handleImport}
          disabled={isImporting}
          className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          <Upload size={12} />
          {isImporting ? "导入中..." : "导入扩展包"}
        </button>
      </div>

      {error && (
        <div className="rounded-md bg-red-500/10 p-2 text-xs text-red-500">{error}</div>
      )}

      {lastResult && (
        <div className="space-y-1 rounded-md bg-muted/50 p-3 text-xs">
          <div className="font-medium">
            <Package size={12} className="mr-1 inline" />
            已导入 {lastResult.name} v{lastResult.version}
          </div>
          <div className="grid grid-cols-2 gap-1 text-muted-foreground">
            <span><Tags size={10} className="mr-1 inline" />内容级别 +{lastResult.contentLevelsAdded}</span>
            <span><Tags size={10} className="mr-1 inline" />标签 +{lastResult.tagsAdded}</span>
            <span><Film size={10} className="mr-1 inline" />场景模板 +{lastResult.sceneTemplatesAdded}</span>
            <span><SlidersHorizontal size={10} className="mr-1 inline" />滑块预设 +{lastResult.sliderPresetsAdded}</span>
            <span><UserCircle size={10} className="mr-1 inline" />身体档案字段 +{lastResult.schemaFieldsAdded}</span>
            <span><Stethoscope size={10} className="mr-1 inline" />诊断维度 +{lastResult.diagnosticDimensionsAdded}</span>
          </div>
        </div>
      )}

      <div>
        <div className="mb-2 text-xs text-muted-foreground">已安装扩展包</div>
        {installed.length === 0 ? (
          <div className="text-xs text-muted-foreground">暂无扩展包</div>
        ) : (
          <div className="space-y-1">
            {installed.map((ext) => (
              <div
                key={`${ext.name}-${ext.version}`}
                className="flex items-center justify-between rounded-md border border-panel-border p-2 text-xs"
              >
                <span className="font-medium">{ext.name}</span>
                <span className="text-muted-foreground">v{ext.version}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-md border border-panel-border p-3 text-xs text-muted-foreground">
        <div className="mb-1 font-medium text-foreground">扩展包格式说明</div>
        <p>扩展包是一个 JSON 文件，可声明内容级别、标签、场景模板、身体档案字段、滑块预设和诊断维度。</p>
        <p className="mt-1">通过扩展包注入成人内容、流派模板或自定义诊断维度，应用本体不携带具体数据。</p>
      </div>
    </div>
  );
}
