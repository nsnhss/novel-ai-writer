import { useEffect, useState } from "react";
import { Plus, Loader2, Trash2, Edit2, Key, Wifi, Eye, EyeOff, Sparkles, Star, ChevronDown, ChevronUp, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { useModelStore, type AiModel, type CreateModelRequest, type ModelRecommendation } from "@/stores/modelStore";

const PROVIDER_OPTIONS = [
  { value: "ollama", label: "Ollama（本地，无需 API Key）" },
  { value: "openai_compatible", label: "DeepSeek / OpenAI 兼容（需 API Key）" },
];

const DEFAULT_MODEL_PARAMS = {
  temperature: 0.7,
  top_p: 0.9,
  top_k: 0,
  repetition_penalty: 1.0,
  frequency_penalty: 0.0,
  max_tokens: 2000,
};

function RecommendationCard({
  rec,
  added,
  canAdd,
  ollamaReady,
  onApply,
}: {
  rec: ModelRecommendation;
  added: boolean;
  canAdd: boolean;
  ollamaReady: boolean;
  onApply: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-md border border-panel-border p-2.5 text-xs">
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium">{rec.name}</span>
          <span
            className={cn(
              "rounded px-1 py-0.5 text-[10px]",
              rec.provider === "ollama"
                ? "bg-green-500/10 text-green-500"
                : "bg-blue-500/10 text-blue-500"
            )}
          >
            {rec.provider === "ollama" ? "Ollama" : "API"}
          </span>
          <span className="flex items-center gap-0.5 text-yellow-500">
            <Star size={10} fill="currentColor" /> {rec.score.toFixed(1)}
          </span>
        </div>
        {added ? (
          <span className="rounded bg-muted px-2 py-1 text-[10px] text-muted-foreground">已添加</span>
        ) : (
          <button
            onClick={onApply}
            disabled={!canAdd}
            className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[10px] text-primary-foreground hover:opacity-90 disabled:opacity-50"
            title={
              rec.provider === "ollama" && !ollamaReady
                ? "请先使用 Ollama 拉取该模型"
                : "一键配置为默认模型"
            }
          >
            <Download size={10} /> 一键配置
          </button>
        )}
      </div>

      <p className="mb-1.5 text-muted-foreground">{rec.note}</p>

      {rec.tags.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {rec.tags.map((tag) => (
            <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {tag}
            </span>
          ))}
        </div>
      )}

      {rec.sampleOutput && (
        <div>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-0.5 text-[10px] text-primary hover:underline"
          >
            {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            样例效果
          </button>
          {expanded && (
            <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-muted p-1.5 text-[10px] text-muted-foreground">
              {rec.sampleOutput}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function ModelParamRow({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-20 text-muted-foreground">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 flex-1 cursor-pointer appearance-none rounded bg-muted accent-primary"
      />
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-16 rounded bg-muted px-1.5 py-1 text-right outline-none"
      />
    </div>
  );
}

export function ModelSettings() {
  const {
    models,
    currentModel,
    isLoading,
    ollamaModels,
    recommendations,
    loadModels,
    createModel,
    updateModel,
    deleteModel,
    setDefaultModel,
    switchModel,
    setApiKey,
    hasApiKey,
    testConnection,
    checkOllamaStatus,
    loadRecommendations,
    applyRecommendation,
  } = useModelStore();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CreateModelRequest & { apiKey: string }>({
    name: "",
    provider: "openai_compatible",
    endpoint: "https://api.deepseek.com",
    modelName: "deepseek-v4-flash",
    parameters: JSON.stringify({ temperature: 0.7, top_p: 0.9, top_k: 0, repetition_penalty: 1.0, frequency_penalty: 0.0, max_tokens: 2000 }),
    apiKey: "",
  });
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({});
  const [apiKeyStatus, setApiKeyStatus] = useState<Record<string, boolean>>({});
  const [testingIds, setTestingIds] = useState<Set<string>>(new Set());
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; error?: string } | null>>({});

  useEffect(() => {
    loadModels();
    useModelStore.getState().loadCurrentModel();
    loadRecommendations();
    checkOllamaStatus();
  }, [loadModels, loadRecommendations, checkOllamaStatus]);

  useEffect(() => {
    models.forEach(async (m) => {
      if (m.provider === "openai_compatible") {
        const ok = await hasApiKey(m.id);
        setApiKeyStatus((prev) => ({ ...prev, [m.id]: ok }));
      }
    });
  }, [models, hasApiKey]);

  const updateProvider = (provider: "ollama" | "openai_compatible") => {
    setForm((f) => ({
      ...f,
      provider,
      endpoint: provider === "ollama" ? "http://localhost:11434" : "https://api.deepseek.com",
      modelName: provider === "ollama" ? "qwen2.5" : "deepseek-v4-flash",
    }));
  };

  const resetForm = () => {
    setForm({
      name: "",
      provider: "openai_compatible",
      endpoint: "https://api.deepseek.com",
      modelName: "deepseek-v4-flash",
      parameters: JSON.stringify({ temperature: 0.7, top_p: 0.9, top_k: 0, repetition_penalty: 1.0, frequency_penalty: 0.0, max_tokens: 2000 }),
      apiKey: "",
    });
    setShowApiKey(false);
    setEditingId(null);
    setShowForm(false);
  };

  const startEdit = (model: AiModel) => {
    setEditingId(model.id);
    const params = model.parameters?.trim() ? model.parameters : JSON.stringify(DEFAULT_MODEL_PARAMS);
    setForm({
      name: model.name,
      provider: model.provider as "ollama" | "openai_compatible",
      endpoint: model.endpoint,
      modelName: model.modelName,
      parameters: params,
      apiKey: "",
    });
    setShowApiKey(false);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error("请输入模型名称"); return; }
    if (!form.modelName.trim()) { toast.error("请输入模型名"); return; }
    if (form.provider === "openai_compatible" && !editingId && !form.apiKey.trim()) {
      toast.error("DeepSeek / OpenAI 兼容模型必须填写 API Key");
      return;
    }
    try {
      let model: AiModel;
      if (editingId) {
        model = await updateModel({
          id: editingId,
          name: form.name,
          provider: form.provider as "ollama" | "openai_compatible",
          endpoint: form.endpoint,
          modelName: form.modelName,
          parameters: form.parameters,
        });
      } else {
        model = await createModel({
          name: form.name,
          provider: form.provider as "ollama" | "openai_compatible",
          endpoint: form.endpoint,
          modelName: form.modelName,
          parameters: form.parameters,
        });
      }

      if (form.apiKey.trim()) {
        await setApiKey(model.id, form.apiKey.trim());
      }
    } catch (err) {
      toast.error(`保存失败: ${err}`);
      return;
    }
    resetForm();
  };

  const handleTest = async (id: string) => {
    setTestingIds((prev) => new Set(prev).add(id));
    setTestResults((prev) => ({ ...prev, [id]: null }));
    try {
      const res = await testConnection(id);
      setTestResults((prev) => ({ ...prev, [id]: res }));
    } catch (err) {
      setTestResults((prev) => ({ ...prev, [id]: { ok: false, error: String(err) } }));
    } finally {
      setTestingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleSaveApiKey = async (id: string) => {
    const key = apiKeyInputs[id];
    if (!key) return;
    try {
      await setApiKey(id, key);
      setApiKeyInputs((prev) => ({ ...prev, [id]: "" }));
      setApiKeyStatus((prev) => ({ ...prev, [id]: true }));
    } catch (err) {
      toast.error(`保存 API Key 失败: ${err}`);
    }
  };

  const needsApiKey = form.provider === "openai_compatible";

  const effectiveEndpoint = (rec: ModelRecommendation) =>
    rec.endpoint ?? (rec.provider === "ollama" ? "http://localhost:11434" : "https://api.deepseek.com");

  const isRecommendationAdded = (rec: ModelRecommendation) =>
    models.some(
      (m) =>
        m.modelName === rec.modelName &&
        m.provider === rec.provider &&
        m.endpoint === effectiveEndpoint(rec)
    );

  const isOllamaModelAvailable = (rec: ModelRecommendation) =>
    rec.provider === "ollama" && ollamaModels.includes(rec.modelName);

  const handleApplyRecommendation = async (rec: ModelRecommendation) => {
    if (rec.provider === "openai_compatible") {
      const key = window.prompt(`请输入 ${rec.name} 的 API Key:`);
      if (key === null) return;
      if (!key.trim()) {
        toast.error("API Key 不能为空");
        return;
      }
      try {
        await applyRecommendation(rec, key.trim());
      } catch (err) {
        toast.error(`配置失败: ${err}`);
      }
      return;
    }
    try {
      await applyRecommendation(rec);
    } catch (err) {
      toast.error(`配置失败: ${err}`);
    }
  };

  return (
    <div className="space-y-4 text-sm">
      {recommendations.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1 font-medium text-primary">
            <Sparkles size={14} /> 推荐模型
          </div>
          <div className="space-y-2">
            {recommendations.map((rec) => {
              const added = isRecommendationAdded(rec);
              const ollamaReady = rec.provider === "ollama" && isOllamaModelAvailable(rec);
              const canAdd = !added && (rec.provider !== "ollama" || ollamaReady);
              return (
                <RecommendationCard
                  key={`${rec.provider}-${rec.modelName}`}
                  rec={rec}
                  added={added}
                  canAdd={canAdd}
                  ollamaReady={ollamaReady}
                  onApply={() => handleApplyRecommendation(rec)}
                />
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="font-medium">模型列表</span>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:opacity-90"
        >
          <Plus size={12} />
          添加模型
        </button>
      </div>

      {showForm && (
        <div className="space-y-2 rounded-md border border-panel-border p-3">
          {/* Row 1: name + provider */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">显示名称</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="例如：我的 DeepSeek"
                className="w-full rounded-md bg-muted px-2 py-1.5 text-xs outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">提供方</label>
              <select
                value={form.provider}
                onChange={(e) => updateProvider(e.target.value as "ollama" | "openai_compatible")}
                className="w-full rounded-md bg-muted px-2 py-1.5 text-xs outline-none"
              >
                {PROVIDER_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 2: endpoint */}
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">API 端点</label>
            <input
              type="text"
              value={form.endpoint}
              onChange={(e) => setForm((f) => ({ ...f, endpoint: e.target.value }))}
              className="w-full rounded-md bg-muted px-2 py-1.5 text-xs font-mono outline-none"
            />
          </div>

          {/* Row 3: modelName */}
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">模型名</label>
            <input
              type="text"
              value={form.modelName}
              onChange={(e) => setForm((f) => ({ ...f, modelName: e.target.value }))}
              className="w-full rounded-md bg-muted px-2 py-1.5 text-xs font-mono outline-none"
            />
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {form.provider === "ollama"
                ? "Ollama 模型名，如 qwen2.5、qwen2.5:14b"
                : "API 模型名，如 deepseek-v4-flash、deepseek-v4-pro"}
            </p>
          </div>

          {/* Row 4: API Key (only for non-ollama) */}
          {needsApiKey && (
            <div>
              <label className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                <Key size={10} />
                API Key
                <span className="text-red-400">*</span>
              </label>
              <div className="flex gap-1">
                <input
                  type={showApiKey ? "text" : "password"}
                  value={form.apiKey}
                  onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                  placeholder="sk-xxxxxxxxxxxxxxxx"
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
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                密钥加密存储在系统凭据管理器，不会明文写入数据库
              </p>
            </div>
          )}

          {/* Row 5: parameters */}
          <div className="space-y-2 rounded-md bg-muted/30 p-2">
            <div className="text-xs text-muted-foreground">模型参数</div>
            {(() => {
              const parsed: Record<string, number> = { ...DEFAULT_MODEL_PARAMS };
              try {
                Object.assign(parsed, JSON.parse(form.parameters || "{}"));
              } catch {
                /* ignore */
              }
              const update = (key: keyof typeof DEFAULT_MODEL_PARAMS, value: number) => {
                const next = { ...parsed, [key]: value };
                setForm((f) => ({ ...f, parameters: JSON.stringify(next) }));
              };
              return (
                <>
                  <ModelParamRow label="温度" min={0} max={2} step={0.1} value={parsed.temperature} onChange={(v) => update("temperature", v)} />
                  <ModelParamRow label="Top P" min={0} max={1} step={0.05} value={parsed.top_p} onChange={(v) => update("top_p", v)} />
                  <ModelParamRow label="Top K" min={0} max={100} step={1} value={parsed.top_k} onChange={(v) => update("top_k", v)} />
                  <ModelParamRow label="重复惩罚" min={0.5} max={2} step={0.05} value={parsed.repetition_penalty} onChange={(v) => update("repetition_penalty", v)} />
                  <ModelParamRow label="频率惩罚" min={-2} max={2} step={0.1} value={parsed.frequency_penalty} onChange={(v) => update("frequency_penalty", v)} />
                  <ModelParamRow label="最大 Token" min={100} max={16000} step={100} value={parsed.max_tokens} onChange={(v) => update("max_tokens", v)} />
                </>
              );
            })()}
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={resetForm} className="rounded-md bg-muted px-2 py-1 text-xs hover:bg-muted/80">
              取消
            </button>
            <button onClick={handleSave} className="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground hover:opacity-90">
              {editingId ? "保存修改" : "添加并保存"}
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="py-4 text-center text-xs text-muted-foreground">加载中…</div>
      ) : models.length === 0 ? (
        <div className="py-4 text-center text-xs text-muted-foreground">暂无模型配置，点击上方按钮添加</div>
      ) : (
        <div className="space-y-2">
          {models.map((model) => (
            <div
              key={model.id}
              className={cn(
                "rounded-md border border-panel-border p-2",
                currentModel?.id === model.id && "border-primary/50 bg-primary/5"
              )}
            >
              <div className="mb-1 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{model.name}</span>
                  {model.isDefault && (
                    <span className="rounded bg-green-500/10 px-1 py-0.5 text-[10px] text-green-500">默认</span>
                  )}
                  {currentModel?.id === model.id && (
                    <span className="rounded bg-primary/10 px-1 py-0.5 text-[10px] text-primary">当前</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => startEdit(model)} className="rounded p-1 text-muted-foreground hover:bg-muted" title="编辑">
                    <Edit2 size={12} />
                  </button>
                  <button
                    onClick={() => handleTest(model.id)}
                    disabled={testingIds.has(model.id)}
                    className="rounded p-1 text-muted-foreground hover:bg-muted" title="测试连接"
                  >
                    {testingIds.has(model.id) ? <Loader2 size={12} className="animate-spin" /> : <Wifi size={12} />}
                  </button>
                  <button onClick={() => deleteModel(model.id)} className="rounded p-1 text-red-500 hover:bg-muted" title="删除">
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>

              <div className="mb-2 text-xs text-muted-foreground">
                <div>{model.provider === "ollama" ? "Ollama 本地" : `API: ${model.endpoint}`}</div>
                <div className="font-mono">{model.modelName}</div>
              </div>

              {model.provider === "openai_compatible" && (
                <div className="mb-2 flex items-center gap-2">
                  <input
                    type="password"
                    value={apiKeyInputs[model.id] || ""}
                    onChange={(e) => setApiKeyInputs((prev) => ({ ...prev, [model.id]: e.target.value }))}
                    placeholder={apiKeyStatus[model.id] ? "API Key 已保存（可输入新 Key 替换）" : "输入 API Key"}
                    className="flex-1 rounded-md bg-muted px-2 py-1 text-xs outline-none"
                  />
                  <button
                    onClick={() => handleSaveApiKey(model.id)}
                    disabled={!apiKeyInputs[model.id]}
                    className="rounded-md bg-muted px-2 py-1 text-xs hover:bg-muted/80 disabled:opacity-50"
                    title="保存 API Key"
                  >
                    <Key size={12} />
                  </button>
                </div>
              )}

              {testResults[model.id] && (
                <div
                  className={cn(
                    "mb-2 rounded px-2 py-1 text-xs",
                    testResults[model.id]?.ok ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"
                  )}
                >
                  {testResults[model.id]?.ok
                    ? "连接成功"
                    : `连接失败${testResults[model.id]?.error ? `: ${testResults[model.id]?.error}` : ""}`}
                </div>
              )}

              <div className="flex gap-2">
                {!model.isDefault && (
                  <button onClick={() => setDefaultModel(model.id)} className="flex-1 rounded-md bg-muted py-1 text-xs hover:bg-muted/80">
                    设为默认
                  </button>
                )}
                <button
                  onClick={() => switchModel(model.id)}
                  className={cn(
                    "flex-1 rounded-md py-1 text-xs",
                    currentModel?.id === model.id ? "bg-primary/20 text-primary" : "bg-muted hover:bg-muted/80"
                  )}
                >
                  {currentModel?.id === model.id ? "已选中" : "切换到此模型"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
