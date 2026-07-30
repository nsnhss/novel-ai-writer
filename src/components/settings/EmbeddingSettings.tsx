import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "@/lib/toast";
import { Key, Wifi, Loader2, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmbeddingConfigView {
  provider: string;
  endpoint: string;
  model: string;
  hasApiKey: boolean;
  dimensions: number;
}

const PROVIDER_OPTIONS = [
  { value: "ollama", label: "Ollama（本地）" },
  { value: "openai_compatible", label: "OpenAI 兼容（DeepSeek / 第三方）" },
];

const DEFAULT_ENDPOINTS: Record<string, string> = {
  ollama: "http://localhost:11434",
  openai_compatible: "https://api.deepseek.com",
};

const DEFAULT_MODELS: Record<string, string> = {
  ollama: "bge-m3",
  openai_compatible: "deepseek-embedding",
};

export function EmbeddingSettings() {
  const [config, setConfig] = useState<EmbeddingConfigView | null>(null);
  const [form, setForm] = useState({
    provider: "ollama",
    endpoint: "",
    model: "",
    apiKey: "",
    dimensions: 1024,
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string; dimensions?: number } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const c = await invoke<EmbeddingConfigView>("get_embedding_config");
      setConfig(c);
      setForm({
        provider: c.provider,
        endpoint: c.endpoint,
        model: c.model,
        apiKey: "",
        dimensions: c.dimensions,
      });
      setTestResult(null);
    } catch (err) {
      toast.error(`加载嵌入配置失败: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const updateProvider = (provider: string) => {
    setForm((f) => ({
      ...f,
      provider,
      endpoint: DEFAULT_ENDPOINTS[provider] ?? f.endpoint,
      model: DEFAULT_MODELS[provider] ?? f.model,
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const c = await invoke<EmbeddingConfigView>("set_embedding_config", {
        req: {
          provider: form.provider,
          endpoint: form.endpoint.trim() || null,
          model: form.model.trim() || null,
          apiKey: form.apiKey.trim() || null,
          dimensions: Number(form.dimensions) || null,
        },
      });
      setConfig(c);
      setForm((f) => ({ ...f, apiKey: "" }));
      setTestResult(null);
      toast.success("保存成功，重启应用后新配置生效\n（若修改了维度或模型，建议重新导入素材）");
    } catch (err) {
      toast.error(`保存失败: ${err}`);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await invoke<{ ok: boolean; error?: string; dimensions?: number }>(
        "test_embedding_connection"
      );
      setTestResult(res);
    } catch (err) {
      setTestResult({ ok: false, error: String(err) });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return <div className="py-4 text-center text-xs text-muted-foreground">加载中…</div>;
  }

  const needsApiKey = form.provider === "openai_compatible";

  return (
    <div className="space-y-4 text-sm">
      <div className="text-xs text-muted-foreground">
        嵌入模型用于 RAG（素材检索）。修改后需要重启应用；若更换了模型或维度，建议重新导入素材。
        <br />
        DeepSeek 官方是否提供 embedding API 请以最新文档为准，若不支持请换用其它 OpenAI 兼容端点。
      </div>

      <div>
        <label className="mb-1 block text-xs text-muted-foreground">提供方</label>
        <select
          value={form.provider}
          onChange={(e) => updateProvider(e.target.value)}
          className="w-full rounded-md bg-muted px-2 py-1.5 text-xs outline-none"
        >
          {PROVIDER_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-xs text-muted-foreground">API 端点</label>
        <input
          type="text"
          value={form.endpoint}
          onChange={(e) => setForm((f) => ({ ...f, endpoint: e.target.value }))}
          className="w-full rounded-md bg-muted px-2 py-1.5 text-xs font-mono outline-none"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs text-muted-foreground">模型名</label>
        <input
          type="text"
          value={form.model}
          onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
          className="w-full rounded-md bg-muted px-2 py-1.5 text-xs font-mono outline-none"
        />
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          {form.provider === "ollama"
            ? "例如：bge-m3、nomic-embed-text"
            : "例如：deepseek-embedding、text-embedding-3-small"}
        </p>
      </div>

      {needsApiKey && (
        <div>
          <label className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Key size={10} />
            API Key
          </label>
          <div className="flex gap-1">
            <input
              type={showApiKey ? "text" : "password"}
              value={form.apiKey}
              onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
              placeholder={config?.hasApiKey ? "已保存（输入可覆盖）" : "sk-xxxxxxxxxxxxxxxx"}
              className="flex-1 rounded-md bg-muted px-2 py-1.5 text-xs font-mono outline-none"
            />
            <button
              onClick={() => setShowApiKey((s) => !s)}
              className="rounded-md bg-muted p-1.5 hover:bg-muted/80"
              title={showApiKey ? "隐藏" : "显示"}
            >
              {showApiKey ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
          </div>
        </div>
      )}

      <div>
        <label className="mb-1 block text-xs text-muted-foreground">向量维度</label>
        <input
          type="number"
          value={form.dimensions}
          onChange={(e) => setForm((f) => ({ ...f, dimensions: Number(e.target.value) }))}
          className="w-full rounded-md bg-muted px-2 py-1.5 text-xs font-mono outline-none"
        />
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          必须与模型输出维度一致，如 bge-m3 是 1024，text-embedding-3-small 是 1536。
        </p>
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleTest}
          disabled={testing}
          className="flex items-center justify-center gap-1 flex-1 rounded-md bg-muted py-1.5 text-xs hover:bg-muted/80 disabled:opacity-50"
        >
          {testing ? <Loader2 size={12} className="animate-spin" /> : <Wifi size={12} />}
          测试连接
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 rounded-md bg-primary py-1.5 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "保存中…" : "保存配置"}
        </button>
      </div>

      {testResult && (
        <div
          className={cn(
            "rounded px-2 py-1 text-xs",
            testResult.ok ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"
          )}
        >
          {testResult.ok
            ? `连接成功${testResult.dimensions ? `，维度 ${testResult.dimensions}` : ""}`
            : `连接失败${testResult.error ? `: ${testResult.error}` : ""}`}
        </div>
      )}
    </div>
  );
}
