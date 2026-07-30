import { useEffect, useMemo, useState } from "react";
import { Plus, Save, Trash2, X, Edit3, LayoutTemplate } from "lucide-react";
import {
  useSceneTemplateStore,
  type SceneTemplate,
  type CreateSceneTemplateRequest,
  type UpdateSceneTemplateRequest,
} from "@/stores/sceneTemplateStore";

export function SceneTemplatePanel() {
  const {
    templates,
    categories,
    isLoading,
    loadTemplates,
    loadCategories,
    createTemplate,
    updateTemplate,
    deleteTemplate,
  } = useSceneTemplateStore();

  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [isEditing, setIsEditing] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [categoryMode, setCategoryMode] = useState<"select" | "custom">("select");
  const [category, setCategory] = useState("");
  const [promptTemplate, setPromptTemplate] = useState("");
  const [isAdult, setIsAdult] = useState(false);
  const [adultPrompt, setAdultPrompt] = useState("");
  const [beats, setBeats] = useState("");
  const [beatsError, setBeatsError] = useState("");

  useEffect(() => {
    loadTemplates(selectedCategory || undefined);
    loadCategories();
  }, [loadTemplates, loadCategories, selectedCategory]);

  const grouped = useMemo(() => {
    const map = new Map<string, SceneTemplate[]>();
    for (const t of templates) {
      const list = map.get(t.category) ?? [];
      list.push(t);
      map.set(t.category, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [templates]);

  const resetForm = () => {
    setEditId(null);
    setName("");
    setCategory("");
    setCategoryMode("select");
    setPromptTemplate("");
    setIsAdult(false);
    setAdultPrompt("");
    setBeats("");
    setBeatsError("");
    setIsEditing(false);
  };

  const startCreate = () => {
    resetForm();
    setCategory(categories[0] || "");
    setIsEditing(true);
  };

  const startEdit = (t: SceneTemplate) => {
    setEditId(t.id);
    setName(t.name);
    setCategory(t.category);
    setCategoryMode(categories.includes(t.category) ? "select" : "custom");
    setPromptTemplate(t.promptTemplate);
    setIsAdult(t.isAdult);
    setAdultPrompt(t.adultPrompt);
    setBeats(t.beats || "");
    setBeatsError("");
    setIsEditing(true);
  };

  const handleSave = async () => {
    const trimmedName = name.trim();
    const trimmedCategory = category.trim();
    const trimmedPrompt = promptTemplate.trim();
    if (!trimmedName || !trimmedCategory || !trimmedPrompt) return;

    const trimmedBeats = beats.trim();
    if (trimmedBeats) {
      try {
        JSON.parse(trimmedBeats);
        setBeatsError("");
      } catch {
        setBeatsError("节拍 JSON 格式错误");
        return;
      }
    }

    if (editId) {
      const req: UpdateSceneTemplateRequest = {
        id: editId,
        name: trimmedName,
        category: trimmedCategory,
        promptTemplate: trimmedPrompt,
        isAdult,
        adultPrompt: adultPrompt.trim(),
        beats: trimmedBeats,
      };
      await updateTemplate(req);
    } else {
      const req: CreateSceneTemplateRequest = {
        name: trimmedName,
        category: trimmedCategory,
        promptTemplate: trimmedPrompt,
        isAdult,
        adultPrompt: adultPrompt.trim(),
        beats: trimmedBeats,
      };
      await createTemplate(req);
    }
    resetForm();
  };

  return (
    <div className="flex h-full flex-col p-3">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium">场景模板</h3>
        <button
          onClick={startCreate}
          className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:opacity-90"
        >
          <Plus size={12} /> 新建
        </button>
      </div>

      <div className="mb-3 flex items-center gap-2">
        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="flex-1 rounded-md bg-muted px-2 py-1.5 text-xs outline-none"
        >
          <option value="">全部分类</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
      </div>

      {isEditing && (
        <div className="mb-3 space-y-2 rounded-md border border-panel-border bg-muted/30 p-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="模板名称"
            className="w-full rounded bg-muted px-2 py-1 text-xs outline-none"
          />

          <div className="flex items-center gap-2">
            <select
              value={categoryMode}
              onChange={(e) => {
                const mode = e.target.value as "select" | "custom";
                setCategoryMode(mode);
                if (mode === "select") {
                  setCategory(categories[0] || "");
                } else {
                  setCategory("");
                }
              }}
              className="rounded bg-muted px-2 py-1 text-xs outline-none"
            >
              <option value="select">选择分类</option>
              <option value="custom">自定义分类</option>
            </select>
            {categoryMode === "select" ? (
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="flex-1 rounded bg-muted px-2 py-1 text-xs outline-none"
              >
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="新分类名"
                className="flex-1 rounded bg-muted px-2 py-1 text-xs outline-none"
              />
            )}
          </div>

          <textarea
            value={promptTemplate}
            onChange={(e) => setPromptTemplate(e.target.value)}
            rows={6}
            placeholder="Prompt 模板内容..."
            className="w-full rounded bg-muted px-2 py-1 text-xs outline-none"
          />

          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={isAdult}
              onChange={(e) => setIsAdult(e.target.checked)}
              className="h-4 w-4"
            />
            成人模板（仅在成人模式下显示并追加下方提示词）
          </label>

          {isAdult && (
            <textarea
              value={adultPrompt}
              onChange={(e) => setAdultPrompt(e.target.value)}
              rows={4}
              placeholder="成人模式下追加的 Prompt..."
              className="w-full rounded bg-muted px-2 py-1 text-xs outline-none"
            />
          )}

          <textarea
            value={beats}
            onChange={(e) => {
              setBeats(e.target.value);
              setBeatsError("");
            }}
            rows={4}
            placeholder={`场景节拍表（JSON 数组，仅在成人模式下注入）\n示例：\n[\n  {"id":1,"name":"紧张","goal":"建立焦虑/期待","length":"200-400字","pov":"女主内心","focus":"心理"}\n]`}
            className="w-full rounded bg-muted px-2 py-1 text-xs outline-none"
          />
          {beatsError && <div className="text-xs text-red-500">{beatsError}</div>}

          <div className="flex justify-end gap-1">
            <button
              onClick={resetForm}
              className="rounded p-1 text-muted-foreground hover:bg-muted"
              title="取消"
            >
              <X size={14} />
            </button>
            <button
              onClick={handleSave}
              disabled={!name.trim() || !category.trim() || !promptTemplate.trim() || !!beatsError}
              className="rounded p-1 text-green-500 hover:bg-muted disabled:opacity-50"
              title="保存"
            >
              <Save size={14} />
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">加载中…</div>
        ) : templates.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            <LayoutTemplate size={24} className="mx-auto mb-2 opacity-50" />
            暂无场景模板
            <br />
            点击右上角新建
          </div>
        ) : (
          grouped.map(([cat, list]) => (
            <div key={cat} className="mb-3">
              <div className="mb-1 px-1 text-xs font-medium text-muted-foreground">{cat}</div>
              <div className="space-y-2">
                {list.map((t) => (
                  <div
                    key={t.id}
                    className="rounded-md border border-panel-border p-2 text-sm hover:bg-muted/50"
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span className="truncate font-medium">
                        {t.name}
                        {t.isAdult && (
                          <span className="ml-1.5 rounded bg-red-500/10 px-1 py-0.5 text-[10px] text-red-500">
                            成人
                          </span>
                        )}
                      </span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => startEdit(t)}
                          className="rounded p-1 text-muted-foreground hover:bg-muted"
                          title="编辑"
                        >
                          <Edit3 size={12} />
                        </button>
                        <button
                          onClick={() => deleteTemplate(t.id)}
                          className="rounded p-1 text-red-500 hover:bg-muted"
                          title="删除"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                    <p className="line-clamp-3 text-xs text-muted-foreground">{t.promptTemplate}</p>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
