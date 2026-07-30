import { useEffect, useState } from "react";
import { Plus, Save, Trash2, X, EyeOff, Check } from "lucide-react";
import { usePrivacyStore, type PrivacyFilterRule, type CreatePrivacyFilterRuleRequest, type UpdatePrivacyFilterRuleRequest } from "@/stores/privacyStore";
import { useAppConfigStore } from "@/stores/appConfigStore";

export function PrivacyPanel() {
  const { enabled: privacyEnabled, rules, isLoading, loadRules, loadMode, toggleEnabled, createRule, updateRule, deleteRule } = usePrivacyStore();
  const { adultMode, loadAdultMode, setAdultMode } = useAppConfigStore();

  const [isEditing, setIsEditing] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [pattern, setPattern] = useState("");
  const [replacement, setReplacement] = useState("***");

  useEffect(() => {
    loadRules();
    loadMode();
    loadAdultMode();
  }, [loadRules, loadMode, loadAdultMode]);

  const resetForm = () => {
    setEditId(null);
    setName("");
    setPattern("");
    setReplacement("***");
    setIsEditing(false);
  };

  const startCreate = () => {
    resetForm();
    setIsEditing(true);
  };

  const startEdit = (rule: PrivacyFilterRule) => {
    setEditId(rule.id);
    setName(rule.name);
    setPattern(rule.pattern);
    setReplacement(rule.replacement);
    setIsEditing(true);
  };

  const handleSave = async () => {
    const trimmedName = name.trim();
    const trimmedPattern = pattern.trim();
    const trimmedReplacement = replacement.trim();
    if (!trimmedName || !trimmedPattern) return;

    if (editId) {
      const req: UpdatePrivacyFilterRuleRequest = {
        id: editId,
        name: trimmedName,
        pattern: trimmedPattern,
        replacement: trimmedReplacement,
      };
      await updateRule(req);
    } else {
      const req: CreatePrivacyFilterRuleRequest = {
        name: trimmedName,
        pattern: trimmedPattern,
        replacement: trimmedReplacement,
      };
      await createRule(req);
    }
    resetForm();
  };

  const toggleActive = async (rule: PrivacyFilterRule) => {
    await updateRule({ id: rule.id, isActive: !rule.isActive });
  };

  return (
    <div className="space-y-3">
      <label className="flex cursor-pointer items-center gap-2 rounded-md border border-panel-border p-3">
        <input
          type="checkbox"
          checked={adultMode}
          onChange={(e) => setAdultMode(e.target.checked)}
          className="h-4 w-4"
        />
        <div>
          <div className="text-sm">成人模式</div>
          <div className="text-xs text-muted-foreground">
            开启后角色卡的“身体档案”字段会注入 AI 上下文，并显示成人向场景模板。
          </div>
        </div>
      </label>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">隐私过滤器</h3>
        <button
          onClick={startCreate}
          className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:opacity-90"
        >
          <Plus size={12} /> 新建规则
        </button>
      </div>

      <label className="flex cursor-pointer items-center gap-2 rounded-md border border-panel-border p-3">
        <input
          type="checkbox"
          checked={privacyEnabled}
          onChange={() => toggleEnabled()}
          className="h-4 w-4"
        />
        <div>
          <div className="text-sm">隐私脱敏模式</div>
          <div className="text-xs text-muted-foreground">
            开启后编辑器会遮罩匹配文本，且发送给 AI 的上下文也会自动脱敏。
          </div>
        </div>
      </label>

      <p className="text-xs text-muted-foreground">
        脱敏仅在显示层和 AI 上下文中生效，实际文稿内容不会被修改。
      </p>

      {isEditing && (
        <div className="space-y-2 rounded-md border border-panel-border bg-muted/30 p-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="规则名称"
            className="w-full rounded bg-muted px-2 py-1 text-xs outline-none"
          />
          <input
            type="text"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="正则表达式"
            className="w-full rounded bg-muted px-2 py-1 text-xs outline-none"
          />
          <input
            type="text"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            placeholder="替换为（默认 ***）"
            className="w-full rounded bg-muted px-2 py-1 text-xs outline-none"
          />
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
              disabled={!name.trim() || !pattern.trim()}
              className="rounded p-1 text-green-500 hover:bg-muted disabled:opacity-50"
              title="保存"
            >
              <Save size={14} />
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {isLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground">加载中…</div>
        ) : rules.length === 0 ? (
          <div className="py-4 text-center text-xs text-muted-foreground">
            暂无规则，脱敏模式不会生效
          </div>
        ) : (
          rules.map((rule) => (
            <div
              key={rule.id}
              className="flex items-center justify-between rounded-md border border-panel-border p-2 text-xs"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{rule.name}</span>
                  {!rule.isActive && (
                    <span className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">已停用</span>
                  )}
                </div>
                <div className="mt-0.5 truncate text-muted-foreground">
                  {rule.pattern} → {rule.replacement}
                </div>
              </div>
              <div className="ml-2 flex items-center gap-1">
                <button
                  onClick={() => toggleActive(rule)}
                  className="rounded p-1 text-muted-foreground hover:bg-muted"
                  title={rule.isActive ? "停用" : "启用"}
                >
                  {rule.isActive ? <EyeOff size={12} /> : <Check size={12} />}
                </button>
                <button
                  onClick={() => startEdit(rule)}
                  className="rounded p-1 text-muted-foreground hover:bg-muted"
                  title="编辑"
                >
                  <Save size={12} />
                </button>
                <button
                  onClick={() => deleteRule(rule.id)}
                  className="rounded p-1 text-red-500 hover:bg-muted"
                  title="删除"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
