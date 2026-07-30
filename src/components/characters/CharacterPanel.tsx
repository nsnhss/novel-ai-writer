import { useEffect, useMemo, useState } from "react";
import { Plus, Save, Trash2, X, Edit3, UserRound, PlusCircle, MinusCircle, Search, Send, ChevronDown, ChevronUp } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useBookStore } from "@/stores/bookStore";
import {
  useCharacterStore,
  parseExtendedProfile,
  stringifyExtendedProfile,
} from "@/stores/characterStore";
import { useGenerationStore } from "@/stores/generationStore";
import { useAppConfigStore } from "@/stores/appConfigStore";
import { useUIStore } from "@/stores/uiStore";
import { getEditorRef } from "@/lib/editorRef";
import type { CharacterCard, CreateCharacterRequest, UpdateCharacterRequest } from "@/stores/characterStore";

export function CharacterPanel() {
  const { currentBookId } = useBookStore();
  const { characters, isLoading, loadCharacters, createCharacter, updateCharacter, deleteCharacter } =
    useCharacterStore();
  const { setPendingRagQuery } = useGenerationStore();
  const { adultMode, loadAdultMode } = useAppConfigStore();
  const { setRightPanelTab } = useUIStore();

  const [isEditing, setIsEditing] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [aliases, setAliases] = useState("");
  const [description, setDescription] = useState("");
  const [background, setBackground] = useState("");
  const [traits, setTraits] = useState("");
  const [relationships, setRelationships] = useState("");
  const [extended, setExtended] = useState<Record<string, string>>({});
  const [adultProfile, setAdultProfile] = useState<Record<string, string>>({});
  const [profileSchema, setProfileSchema] = useState<{ key: string; label: string; category: string; options: string[]; description: string }[]>([]);
  const [search, setSearch] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (currentBookId) {
      loadCharacters(currentBookId);
    }
    loadAdultMode();
  }, [currentBookId, loadCharacters, loadAdultMode]);

  useEffect(() => {
    invoke<{ key: string; label: string; category: string; options: string[]; description: string }[]>("get_character_profile_schema")
      .then(setProfileSchema)
      .catch(() => setProfileSchema([]));
  }, []);

  const resetForm = () => {
    setEditId(null);
    setName("");
    setAliases("");
    setDescription("");
    setBackground("");
    setTraits("");
    setRelationships("");
    setExtended({});
    setAdultProfile({});
    setIsEditing(false);
  };

  const startCreate = () => {
    resetForm();
    setIsEditing(true);
  };

  const startEdit = (c: CharacterCard) => {
    setEditId(c.id);
    setName(c.name);
    setAliases(c.aliases);
    setDescription(c.description);
    setBackground(c.background);
    setTraits(c.traits);
    setRelationships(c.relationships);
    setExtended(parseExtendedProfile(c.extendedProfile));
    setAdultProfile(parseExtendedProfile(c.adultProfile));
    setIsEditing(true);
  };

  const handleSave = async () => {
    if (!currentBookId || !name.trim()) return;

    const extendedJson = stringifyExtendedProfile(extended);
    const adultJson = stringifyExtendedProfile(adultProfile);

    if (editId) {
      const req: UpdateCharacterRequest = {
        id: editId,
        name: name.trim(),
        aliases: aliases.trim(),
        description: description.trim(),
        background: background.trim(),
        traits: traits.trim(),
        relationships: relationships.trim(),
        extendedProfile: extendedJson,
        adultProfile: adultJson,
      };
      await updateCharacter(req);
    } else {
      const req: CreateCharacterRequest = {
        bookId: currentBookId,
        name: name.trim(),
        aliases: aliases.trim(),
        description: description.trim(),
        background: background.trim(),
        traits: traits.trim(),
        relationships: relationships.trim(),
        extendedProfile: extendedJson,
        adultProfile: adultJson,
      };
      await createCharacter(req);
      if (currentBookId) await loadCharacters(currentBookId);
    }
    resetForm();
  };

  const addExtendedField = () => {
    setExtended((prev) => ({ ...prev, "": "" }));
  };

  const removeExtendedField = (key: string) => {
    setExtended((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const updateExtendedKey = (oldKey: string, newKey: string) => {
    setExtended((prev) => {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(prev)) {
        next[k === oldKey ? newKey : k] = v;
      }
      return next;
    });
  };

  const updateExtendedValue = (key: string, value: string) => {
    setExtended((prev) => ({ ...prev, [key]: value }));
  };

  const addAdultField = () => {
    setAdultProfile((prev) => ({ ...prev, "": "" }));
  };

  const removeAdultField = (key: string) => {
    setAdultProfile((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const updateAdultKey = (oldKey: string, newKey: string) => {
    setAdultProfile((prev) => {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(prev)) {
        next[k === oldKey ? newKey : k] = v;
      }
      return next;
    });
  };

  const updateAdultValue = (key: string, value: string) => {
    setAdultProfile((prev) => ({ ...prev, [key]: value }));
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const insertName = (characterName: string) => {
    getEditorRef()?.insertText(characterName);
  };

  const sendAsReference = (c: CharacterCard) => {
    const lines = [
      `角色：${c.name}`,
      c.aliases && `别名：${c.aliases}`,
      c.description && `描述：${c.description}`,
      c.background && `背景：${c.background}`,
      c.traits && `性格：${c.traits}`,
      c.relationships && `关系：${c.relationships}`,
    ].filter(Boolean);
    const extendedObj = parseExtendedProfile(c.extendedProfile);
    for (const [k, v] of Object.entries(extendedObj)) {
      if (v.trim()) lines.push(`${k}：${v}`);
    }
    if (adultMode) {
      const adultObj = parseExtendedProfile(c.adultProfile);
      for (const [k, v] of Object.entries(adultObj)) {
        if (v.trim()) lines.push(`${k}：${v}`);
      }
    }
    setPendingRagQuery(lines.join("\n"));
    setRightPanelTab("ai");
  };

  const filteredCharacters = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return characters;
    return characters.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.aliases.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q)
    );
  }, [characters, search]);

  if (!currentBookId) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-3 text-sm text-muted-foreground">
        <UserRound size={24} className="mb-2 opacity-50" />
        请先选择一本书
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="relative flex-1">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索角色名/别名/描述"
            className="w-full rounded-md bg-muted py-1.5 pl-7 pr-2 text-xs outline-none"
          />
        </div>
        <button
          onClick={startCreate}
          className="flex items-center gap-1 rounded-md bg-primary px-2 py-1.5 text-xs text-primary-foreground hover:opacity-90"
        >
          <Plus size={12} /> 新建
        </button>
      </div>

      {isEditing && (
        <div className="mb-3 space-y-2 rounded-md border border-panel-border bg-muted/30 p-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="角色名 *"
            className="w-full rounded bg-muted px-2 py-1 text-xs outline-none"
          />
          <input
            type="text"
            value={aliases}
            onChange={(e) => setAliases(e.target.value)}
            placeholder="别名"
            className="w-full rounded bg-muted px-2 py-1 text-xs outline-none"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="描述"
            className="w-full rounded bg-muted px-2 py-1 text-xs outline-none"
          />
          <textarea
            value={background}
            onChange={(e) => setBackground(e.target.value)}
            rows={3}
            placeholder="背景"
            className="w-full rounded bg-muted px-2 py-1 text-xs outline-none"
          />
          <textarea
            value={traits}
            onChange={(e) => setTraits(e.target.value)}
            rows={2}
            placeholder="性格特征（JSON 或自由文本）"
            className="w-full rounded bg-muted px-2 py-1 text-xs outline-none"
          />
          <textarea
            value={relationships}
            onChange={(e) => setRelationships(e.target.value)}
            rows={2}
            placeholder="关系（JSON 或自由文本）"
            className="w-full rounded bg-muted px-2 py-1 text-xs outline-none"
          />

          <div className="border-t border-panel-border pt-2">
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>扩展字段</span>
              <button onClick={addExtendedField} className="flex items-center gap-0.5 text-primary hover:opacity-80">
                <PlusCircle size={10} /> 添加
              </button>
            </div>
            <div className="space-y-1">
              {Object.entries(extended).map(([key, value]) => (
                <div key={key} className="flex items-center gap-1">
                  <input
                    type="text"
                    value={key}
                    onChange={(e) => updateExtendedKey(key, e.target.value)}
                    placeholder="字段名"
                    className="w-24 rounded bg-muted px-2 py-1 text-xs outline-none"
                  />
                  <input
                    type="text"
                    value={value}
                    onChange={(e) => updateExtendedValue(key, e.target.value)}
                    placeholder="内容"
                    className="flex-1 rounded bg-muted px-2 py-1 text-xs outline-none"
                  />
                  <button
                    onClick={() => removeExtendedField(key)}
                    className="rounded p-1 text-muted-foreground hover:bg-muted"
                  >
                    <MinusCircle size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {adultMode && (
            <div className="border-t border-panel-border pt-2">
              <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>身体档案（成人模式）</span>
                <button onClick={addAdultField} className="flex items-center gap-0.5 text-primary hover:opacity-80">
                  <PlusCircle size={10} /> 添加自定义字段
                </button>
              </div>
              <div className="space-y-2">
                {profileSchema.map((field) => (
                  <div key={field.key} className="space-y-1">
                    <label className="text-xs text-muted-foreground">
                      {field.label}
                      {field.description && <span className="ml-1 text-[10px] opacity-70">({field.description})</span>}
                    </label>
                    {field.options.length > 0 ? (
                      <select
                        value={adultProfile[field.key] ?? ""}
                        onChange={(e) => setAdultProfile((prev) => ({ ...prev, [field.key]: e.target.value }))}
                        className="w-full rounded bg-muted px-2 py-1 text-xs outline-none"
                      >
                        <option value="">请选择</option>
                        {field.options.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={adultProfile[field.key] ?? ""}
                        onChange={(e) => setAdultProfile((prev) => ({ ...prev, [field.key]: e.target.value }))}
                        placeholder={field.label}
                        className="w-full rounded bg-muted px-2 py-1 text-xs outline-none"
                      />
                    )}
                  </div>
                ))}
                {Object.entries(adultProfile)
                  .filter(([key]) => !profileSchema.some((f) => f.key === key))
                  .map(([key, value]) => (
                    <div key={key} className="flex items-center gap-1">
                      <input
                        type="text"
                        value={key}
                        onChange={(e) => updateAdultKey(key, e.target.value)}
                        placeholder="字段名"
                        className="w-24 rounded bg-muted px-2 py-1 text-xs outline-none"
                      />
                      <input
                        type="text"
                        value={value}
                        onChange={(e) => updateAdultValue(key, e.target.value)}
                        placeholder="内容"
                        className="flex-1 rounded bg-muted px-2 py-1 text-xs outline-none"
                      />
                      <button
                        onClick={() => removeAdultField(key)}
                        className="rounded p-1 text-muted-foreground hover:bg-muted"
                      >
                        <MinusCircle size={12} />
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          )}

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
              disabled={!name.trim()}
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
        ) : filteredCharacters.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            <UserRound size={24} className="mx-auto mb-2 opacity-50" />
            {search.trim() ? "未找到匹配角色" : "暂无角色卡"}
            <br />
            {!search.trim() && "点击右上角新建"}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredCharacters.map((c) => {
              const expanded = expandedIds.has(c.id);
              const extendedObj = parseExtendedProfile(c.extendedProfile);
              const extendedKeys = Object.keys(extendedObj);
              return (
                <div
                  key={c.id}
                  className="rounded-md border border-panel-border p-2 text-sm hover:bg-muted/50"
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span className="truncate font-medium">{c.name}</span>
                    <div className="flex gap-1">
                      <button
                        onClick={() => insertName(c.name)}
                        className="rounded p-1 text-muted-foreground hover:bg-muted"
                        title="在光标处插入角色名"
                      >
                        <Plus size={12} />
                      </button>
                      <button
                        onClick={() => sendAsReference(c)}
                        className="rounded p-1 text-muted-foreground hover:bg-muted"
                        title="作为参考发送给 AI"
                      >
                        <Send size={12} />
                      </button>
                      <button
                        onClick={() => startEdit(c)}
                        className="rounded p-1 text-muted-foreground hover:bg-muted"
                        title="编辑"
                      >
                        <Edit3 size={12} />
                      </button>
                      <button
                        onClick={() => deleteCharacter(c.id)}
                        className="rounded p-1 text-red-500 hover:bg-muted"
                        title="删除"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                  {c.aliases && <p className="text-xs text-muted-foreground">别名：{c.aliases}</p>}
                  {c.description && (
                    <p className="line-clamp-2 text-xs text-muted-foreground">{c.description}</p>
                  )}

                  {(c.background || c.traits || c.relationships || extendedKeys.length > 0 ||
                    (adultMode && Object.keys(parseExtendedProfile(c.adultProfile)).length > 0)) && (
                    <button
                      onClick={() => toggleExpanded(c.id)}
                      className="mt-1 flex items-center gap-0.5 text-xs text-primary hover:opacity-80"
                    >
                      {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      {expanded ? "收起" : "展开详情"}
                    </button>
                  )}

                  {expanded && (
                    <div className="mt-2 space-y-1 border-t border-panel-border pt-2 text-xs text-muted-foreground">
                      {c.background && <p>背景：{c.background}</p>}
                      {c.traits && <p>性格：{c.traits}</p>}
                      {c.relationships && <p>关系：{c.relationships}</p>}
                      {extendedKeys.length > 0 && (
                        <div className="space-y-0.5">
                          {extendedKeys.map((key) => (
                            <p key={key}>
                              {key}：{extendedObj[key]}
                            </p>
                          ))}
                        </div>
                      )}
                      {adultMode && (
                        <div className="space-y-0.5 border-t border-panel-border pt-1">
                          {Object.entries(parseExtendedProfile(c.adultProfile)).map(([key, value]) =>
                            value.trim() ? (
                              <p key={key}>
                                {key}：{value}
                              </p>
                            ) : null
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
