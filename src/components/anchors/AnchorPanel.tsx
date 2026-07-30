import { useEffect, useState } from "react";
import { Plus, Save, Trash2, X, Edit3, Anchor as AnchorIcon, Eye, EyeOff } from "lucide-react";
import { useBookStore } from "@/stores/bookStore";
import { useAnchorStore, type Anchor } from "@/stores/anchorStore";

export function AnchorPanel() {
  const { currentBookId } = useBookStore();
  const { anchors, isLoading, loadAnchors, createAnchor, updateAnchor, deleteAnchor } = useAnchorStore();

  const [isEditing, setIsEditing] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("general");

  useEffect(() => {
    if (currentBookId) {
      loadAnchors(currentBookId);
    }
  }, [currentBookId, loadAnchors]);

  const resetForm = () => {
    setEditId(null);
    setContent("");
    setCategory("general");
    setIsEditing(false);
  };

  const startCreate = () => {
    resetForm();
    setIsEditing(true);
  };

  const startEdit = (a: Anchor) => {
    setEditId(a.id);
    setContent(a.content);
    setCategory(a.category);
    setIsEditing(true);
  };

  const handleSave = async () => {
    if (!currentBookId || !content.trim()) return;
    if (editId) {
      await updateAnchor({ id: editId, content: content.trim(), category });
    } else {
      await createAnchor({ bookId: currentBookId, content: content.trim(), category });
    }
    resetForm();
  };

  const toggleActive = async (a: Anchor) => {
    await updateAnchor({ id: a.id, isActive: !a.isActive });
  };

  if (!currentBookId) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-3 text-sm text-muted-foreground">
        <AnchorIcon size={24} className="mb-2 opacity-50" />
        请先选择一本书
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col p-3">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium">锚点</h3>
        <button
          onClick={startCreate}
          className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:opacity-90"
        >
          <Plus size={12} /> 新建
        </button>
      </div>

      {isEditing && (
        <div className="mb-3 space-y-2 rounded-md border border-panel-border bg-muted/30 p-3">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={3}
            placeholder="锚点内容（≤50 字，例如：主角左肩有伤疤；反派的真实身份是皇子）"
            className="w-full rounded bg-muted px-2 py-1 text-xs outline-none"
          />
          <input
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="分类"
            className="w-full rounded bg-muted px-2 py-1 text-xs outline-none"
          />
          <div className="flex justify-end gap-1">
            <button onClick={resetForm} className="rounded p-1 text-muted-foreground hover:bg-muted">
              <X size={14} />
            </button>
            <button
              onClick={handleSave}
              disabled={!content.trim()}
              className="rounded p-1 text-green-500 hover:bg-muted disabled:opacity-50"
            >
              <Save size={14} />
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">加载中…</div>
        ) : anchors.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            <AnchorIcon size={24} className="mx-auto mb-2 opacity-50" />
            暂无锚点
            <br />
            点击右上角新建
          </div>
        ) : (
          <div className="space-y-2">
            {anchors.map((a) => (
              <div
                key={a.id}
                className={`rounded-md border border-panel-border p-2 text-sm ${
                  a.isActive ? "opacity-100" : "opacity-60"
                }`}
              >
                <div className="mb-1 flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <button onClick={() => toggleActive(a)} className="rounded p-1 hover:bg-muted" title={a.isActive ? "禁用" : "启用"}>
                      {a.isActive ? <Eye size={12} className="text-green-500" /> : <EyeOff size={12} />}
                    </button>
                    <span className="text-xs text-muted-foreground">{a.category}</span>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => startEdit(a)}
                      className="rounded p-1 text-muted-foreground hover:bg-muted"
                      title="编辑"
                    >
                      <Edit3 size={12} />
                    </button>
                    <button
                      onClick={() => deleteAnchor(a.id)}
                      className="rounded p-1 text-red-500 hover:bg-muted"
                      title="删除"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
                <p className="text-xs whitespace-pre-wrap">{a.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
