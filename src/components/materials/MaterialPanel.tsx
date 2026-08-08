import { useEffect, useState } from "react";
import { toast } from "@/lib/toast";
import { downloadBinary, downloadText } from "@/lib/download";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import {
  Search,
  FileUp,
  Edit3,
  Save,
  X,
  Check,
  Archive,
  Trash2,
  Star,
  ThumbsDown,
  Plus,
  Send,
  ChevronDown,
  ChevronUp,
  Download,
  Layers,
  AlertTriangle,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { cn } from "@/lib/utils";
import { useMaterialStore } from "@/stores/materialStore";
import { useGenerationStore } from "@/stores/generationStore";
import { useUIStore } from "@/stores/uiStore";
import { getEditorRef } from "@/lib/editorRef";

export function MaterialPanel() {
  const {
    materials,
    tags,
    isLoading,
    isImporting,
    searchResults,
    loadMaterials,
    loadTags,
    importMaterial,
    exportMaterials,
    exportMaterialsEpub,
    updateMaterial,
    activateMaterial,
    archiveMaterial,
    deleteMaterial,
    rateMaterial,
    toggleMaterialNegative,
    createTag,
    searchMaterials,
    searchMaterialsFts,
    updateMaterialContentLevel,
    previewImportDuplicates,
    applyStorageTierMigration,
    getCleanupSuggestions,
    batchDeleteMaterials,
  } = useMaterialStore();
  const { setPendingRagQuery } = useGenerationStore();
  const { setRightPanelTab } = useUIStore();

  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"semantic" | "keyword">("semantic");
  const [selectedTagId, setSelectedTagId] = useState<string>("");
  const [newTagName, setNewTagName] = useState("");
  const [newTagCategory, setNewTagCategory] = useState("genre");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editContent, setEditContent] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [duplicateCandidates, setDuplicateCandidates] = useState<{ materialId: string; sourceName: string; maxSimilarity: number; matchedChunks: number }[]>([]);
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const [pendingImportPath, setPendingImportPath] = useState<string | null>(null);
  const [cleanupSuggestions, setCleanupSuggestions] = useState<{ materialId: string; sourceName: string; reason: string }[]>([]);
  const [selectedCleanupIds, setSelectedCleanupIds] = useState<Set<string>>(new Set());
  const [showCleanupDialog, setShowCleanupDialog] = useState(false);

  useEffect(() => {
    loadMaterials();
    loadTags();
  }, [loadMaterials, loadTags]);

  useEffect(() => {
    loadMaterials({ tagFilter: selectedTagId || null });
  }, [selectedTagId, loadMaterials]);

  const handleExport = async (format: "json" | "txt" | "epub") => {
    try {
      if (format === "epub") {
        const { data, fileName } = await exportMaterialsEpub({
          tagFilter: selectedTagId || null,
        });
        downloadBinary(data, fileName, "application/epub+zip");
      } else {
        const { content, fileName } = await exportMaterials({
          format,
          tagFilter: selectedTagId || null,
        });
        downloadText(content, fileName, format === "json" ? "application/json" : "text/plain");
      }
    } catch (err) {
      toast.error(`导出失败: ${err}`);
    }
  };

  const proceedImport = async (filePath: string) => {
    setPendingImportPath(null);
    setShowDuplicateDialog(false);
    await importMaterial(filePath, selectedTagId ? [selectedTagId] : []);
  };

  const handleImport = async () => {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [
        { name: "文本/EPUB", extensions: ["txt", "epub", "md"] },
        { name: "所有文件", extensions: ["*"] },
      ],
    });

    if (!selected || typeof selected !== "string") return;

    try {
      const candidates = await previewImportDuplicates(selected);
      if (candidates.length > 0) {
        setDuplicateCandidates(candidates);
        setPendingImportPath(selected);
        setShowDuplicateDialog(true);
      } else {
        await proceedImport(selected);
      }
    } catch (err) {
      // If duplicate check fails, fall back to normal import.
      await proceedImport(selected);
    }
  };

  const handleStorageTierMigration = async () => {
    try {
      const result = await applyStorageTierMigration();
      toast.success(
        `存储分层整理完成：\n移除非激活素材向量 ${result.removedArchived} 条\n移除冷数据向量 ${result.removedCold} 条\n超出热上限移除 ${result.removedHotOverflow} 条`
      );
    } catch (err) {
      toast.error(`存储整理失败: ${err}`);
    }
  };

  const handleShowCleanupSuggestions = async () => {
    try {
      const suggestions = await getCleanupSuggestions();
      setCleanupSuggestions(suggestions);
      setSelectedCleanupIds(new Set(suggestions.map((s) => s.materialId)));
      setShowCleanupDialog(true);
    } catch (err) {
      toast.error(`获取清理建议失败: ${err}`);
    }
  };

  const handleConfirmCleanup = async () => {
    const ids = Array.from(selectedCleanupIds);
    if (ids.length === 0) {
      setShowCleanupDialog(false);
      return;
    }
    try {
      await batchDeleteMaterials(ids);
      setShowCleanupDialog(false);
      setCleanupSuggestions([]);
      setSelectedCleanupIds(new Set());
    } catch (err) {
      toast.error(`清理失败: ${err}`);
    }
  };

  const toggleCleanupSelection = (id: string) => {
    setSelectedCleanupIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return;
    await createTag(newTagName.trim(), newTagCategory);
    setNewTagName("");
  };

  const handleSearch = async () => {
    if (searchMode === "semantic") {
      await searchMaterials(searchQuery);
    } else {
      await searchMaterialsFts(searchQuery);
    }
  };

  const startEdit = (material: (typeof materials)[0]) => {
    setEditingId(material.id);
    setEditName(material.sourceName);
    setEditContent(material.plainText);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
    setEditContent("");
  };

  const saveEdit = async (id: string) => {
    await updateMaterial(id, editContent.trim() || undefined, editName.trim() || undefined);
    setEditingId(null);
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const insertAtCursor = (text: string) => {
    getEditorRef()?.insertText(text);
  };

  const sendAsReference = (text: string, sourceName: string) => {
    setPendingRagQuery(`【${sourceName}】\n${text.slice(0, 800)}`);
    setRightPanelTab("ai");
  };

  const previewText = (text: string, max = 50) => {
    const normalized = text.replace(/\s+/g, " ").trim();
    return normalized.length > max ? normalized.slice(0, max) + "…" : normalized;
  };

  const contentLevelOptions = ["general", ...tags.filter((t) => t.category === "content_level").map((t) => t.name)];

  return (
    <div className="flex h-full flex-col p-3">
      <div className="mb-2 flex gap-2">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder={searchMode === "semantic" ? "语义搜索素材库..." : "关键词搜索素材库..."}
          className="flex-1 rounded-md bg-muted px-3 py-2 text-sm outline-none ring-ring focus:ring-1"
        />
        <button
          onClick={handleSearch}
          className="rounded-md bg-primary px-3 py-2 text-primary-foreground hover:opacity-90"
        >
          <Search size={16} />
        </button>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSearchMode("semantic")}
            className={cn(
              "rounded px-2 py-1 text-xs",
              searchMode === "semantic"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground"
            )}
          >
            语义
          </button>
          <button
            onClick={() => setSearchMode("keyword")}
            className={cn(
              "rounded px-2 py-1 text-xs",
              searchMode === "keyword"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground"
            )}
          >
            关键词
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => handleExport("json")}
            className="flex items-center gap-1 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <Download size={12} /> JSON
          </button>
          <button
            onClick={() => handleExport("epub")}
            className="flex items-center gap-1 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <Download size={12} /> EPUB
          </button>
          <button
            onClick={() => handleExport("txt")}
            className="flex items-center gap-1 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <Download size={12} /> 文本
          </button>
          <button
            onClick={handleImport}
            disabled={isImporting}
            className="flex items-center gap-1 rounded-md bg-primary px-2 py-1.5 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <FileUp size={12} />
            {isImporting ? "导入中..." : "导入"}
          </button>
          <button
            onClick={handleStorageTierMigration}
            title="热冷分层整理"
            className="flex items-center gap-1 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <Layers size={12} />
          </button>
          <button
            onClick={handleShowCleanupSuggestions}
            title="清理建议"
            className="flex items-center gap-1 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <AlertTriangle size={12} />
          </button>
        </div>
      </div>

      {searchResults.length > 0 && (
        <div className="mb-3 max-h-40 overflow-y-auto rounded-md border border-panel-border">
          <div className="border-b border-panel-border px-2 py-1 text-xs font-medium text-muted-foreground">
            搜索结果
          </div>
          {searchResults.map((result, idx) => (
            <div key={idx} className="border-b border-panel-border p-2 text-xs last:border-0">
              <div className="mb-1 flex items-center justify-between text-muted-foreground">
                <span>素材 {result.materialId.slice(0, 8)}</span>
                <span>相似度 {(1 - result.distance).toFixed(3)}</span>
              </div>
              <p className="line-clamp-2">{result.chunkText}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mb-2 flex flex-wrap gap-1">
        <button
          onClick={() => setSelectedTagId("")}
          className={cn(
            "rounded px-2 py-1 text-xs",
            selectedTagId === ""
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:text-foreground"
          )}
        >
          全部
        </button>
        {tags.map((tag) => (
          <button
            key={tag.id}
            onClick={() => setSelectedTagId(tag.id)}
            className={cn(
              "rounded px-2 py-1 text-xs",
              selectedTagId === tag.id
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground"
            )}
          >
            {tag.name}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">加载中…</div>
        ) : materials.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            暂无素材
            <br />
            点击右上角导入小说
          </div>
        ) : (
          materials.map((material) => {
            const expanded = expandedIds.has(material.id);
            return (
              <div
                key={material.id}
                className="mb-2 rounded-md border border-panel-border p-2 text-sm hover:bg-muted/50"
              >
                {editingId === material.id ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full rounded bg-muted px-2 py-1 text-xs outline-none"
                    />
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      rows={4}
                      className="w-full rounded bg-muted px-2 py-1 text-xs outline-none"
                    />
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={cancelEdit}
                        className="rounded p-1 text-muted-foreground hover:bg-muted"
                      >
                        <X size={14} />
                      </button>
                      <button
                        onClick={() => saveEdit(material.id)}
                        className="rounded p-1 text-green-500 hover:bg-muted"
                      >
                        <Save size={14} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="truncate font-medium">
                        {material.sourceName}
                        {material.isNegative && (
                          <span className="ml-1.5 rounded bg-red-500/10 px-1 py-0.5 text-[10px] text-red-500">
                            反例
                          </span>
                        )}
                      </span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => insertAtCursor(material.plainText)}
                          className="rounded p-1 text-muted-foreground hover:bg-muted"
                          title="插入到光标位置"
                        >
                          <Plus size={12} />
                        </button>
                        <button
                          onClick={() => sendAsReference(material.plainText, material.sourceName)}
                          className="rounded p-1 text-muted-foreground hover:bg-muted"
                          title="作为参考发送给 AI"
                        >
                          <Send size={12} />
                        </button>
                        <button
                          onClick={() => startEdit(material)}
                          className="rounded p-1 text-muted-foreground hover:bg-muted"
                          title="编辑"
                        >
                          <Edit3 size={12} />
                        </button>
                        {material.status === "pending" && (
                          <button
                            onClick={() => activateMaterial(material.id)}
                            className="rounded p-1 text-green-500 hover:bg-muted"
                            title="激活"
                          >
                            <Check size={12} />
                          </button>
                        )}
                        {material.status === "active" && (
                          <button
                            onClick={() => archiveMaterial(material.id)}
                            className="rounded p-1 text-muted-foreground hover:bg-muted"
                            title="归档"
                          >
                            <Archive size={12} />
                          </button>
                        )}
                        <button
                          onClick={async () => {
                            const ok = await confirmDialog({
                              title: "删除该素材？",
                              description: "此操作不可撤销。",
                              confirmText: "删除",
                              danger: true,
                            });
                            if (ok) deleteMaterial(material.id);
                          }}
                          className="rounded p-1 text-red-500 hover:bg-muted"
                          title="删除"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                    <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{material.status}</span>
                      <span>{material.plainText.length > 0 ? `${material.plainText.length} 字` : "0 字"}</span>
                      <select
                        value={material.contentLevel}
                        onChange={(e) => updateMaterialContentLevel(material.id, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded bg-muted px-1 py-0.5 text-xs outline-none"
                      >
                        {contentLevelOptions.map((level) => (
                          <option key={level} value={level}>
                            {level}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div
                      onClick={() => toggleExpanded(material.id)}
                      className="cursor-pointer text-xs text-muted-foreground"
                    >
                      {expanded ? (
                        <div className="space-y-2">
                          <pre className="whitespace-pre-wrap text-xs">{material.plainText}</pre>
                          <span className="flex items-center gap-0.5 text-primary">
                            <ChevronUp size={12} /> 收起
                          </span>
                        </div>
                      ) : (
                        <span className="flex items-center gap-0.5">
                          <ChevronDown size={12} />
                          {previewText(material.plainText)}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-1">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          onClick={() => rateMaterial(material.id, star)}
                          className={cn(
                            "rounded p-0.5",
                            material.rating >= star ? "text-yellow-500" : "text-muted-foreground/30"
                          )}
                        >
                          <Star size={10} fill={material.rating >= star ? "currentColor" : "none"} />
                        </button>
                      ))}
                      <span className="mx-1 text-muted-foreground/30">|</span>
                      <button
                        onClick={() => toggleMaterialNegative(material.id, !material.isNegative)}
                        className={cn(
                          "rounded p-0.5",
                          material.isNegative ? "text-red-500" : "text-muted-foreground/30"
                        )}
                        title={material.isNegative ? "取消反例标记" : "标记为反例"}
                      >
                        <ThumbsDown size={10} fill={material.isNegative ? "currentColor" : "none"} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>

      {showDuplicateDialog && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[80%] w-full max-w-md overflow-y-auto rounded-lg border border-panel-border bg-panel p-4 shadow-lg">
            <div className="mb-3 text-sm font-medium">检测到疑似重复素材</div>
            <p className="mb-3 text-xs text-muted-foreground">
              以下已激活素材与待导入文件相似度 ≥ 85%：
            </p>
            <div className="mb-4 space-y-2">
              {duplicateCandidates.map((c) => (
                <div key={c.materialId} className="rounded-md border border-panel-border p-2 text-xs">
                  <div className="font-medium">{c.sourceName}</div>
                  <div className="text-muted-foreground">
                    最高相似度：{(c.maxSimilarity * 100).toFixed(1)}%；匹配片段：{c.matchedChunks}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowDuplicateDialog(false); setPendingImportPath(null); }}
                className="rounded-md bg-muted px-3 py-1.5 text-xs hover:bg-muted/80"
              >
                跳过导入
              </button>
              <button
                onClick={() => pendingImportPath && proceedImport(pendingImportPath)}
                className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90"
              >
                仍要导入
              </button>
            </div>
          </div>
        </div>
      )}

      {showCleanupDialog && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[80%] w-full max-w-md overflow-y-auto rounded-lg border border-panel-border bg-panel p-4 shadow-lg">
            <div className="mb-3 text-sm font-medium">清理建议</div>
            <p className="mb-3 text-xs text-muted-foreground">
              勾选后可一键删除。删除会同时清理向量和素材原文。
            </p>
            {cleanupSuggestions.length === 0 ? (
              <div className="mb-4 text-xs text-muted-foreground">当前没有需要清理的素材。</div>
            ) : (
              <div className="mb-4 space-y-2">
                {cleanupSuggestions.map((s) => (
                  <label
                    key={s.materialId}
                    className="flex cursor-pointer items-start gap-2 rounded-md border border-panel-border p-2 text-xs"
                  >
                    <input
                      type="checkbox"
                      checked={selectedCleanupIds.has(s.materialId)}
                      onChange={() => toggleCleanupSelection(s.materialId)}
                      className="mt-0.5"
                    />
                    <div className="flex-1">
                      <div className="font-medium">{s.sourceName}</div>
                      <div className="text-muted-foreground">{s.reason}</div>
                    </div>
                  </label>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowCleanupDialog(false)}
                className="rounded-md bg-muted px-3 py-1.5 text-xs hover:bg-muted/80"
              >
                取消
              </button>
              <button
                onClick={handleConfirmCleanup}
                disabled={selectedCleanupIds.size === 0}
                className="rounded-md bg-destructive px-3 py-1.5 text-xs text-destructive-foreground hover:opacity-90 disabled:opacity-50"
              >
                删除 {selectedCleanupIds.size} 项
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-3 border-t border-panel-border pt-3">
        <div className="text-xs font-medium text-muted-foreground">新建标签</div>
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            placeholder="标签名"
            className="flex-1 rounded-md bg-muted px-2 py-1 text-xs outline-none"
          />
          <input
            type="text"
            list="tag-categories"
            value={newTagCategory}
            onChange={(e) => setNewTagCategory(e.target.value)}
            placeholder="分类"
            className="w-28 rounded-md bg-muted px-2 py-1 text-xs outline-none"
          />
          <datalist id="tag-categories">
            {Array.from(new Set(tags.map((t) => t.category))).map((cat) => (
              <option key={cat} value={cat} />
            ))}
          </datalist>
          <button
            onClick={handleCreateTag}
            className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:opacity-90"
          >
            添加
          </button>
        </div>
      </div>
    </div>
  );
}
