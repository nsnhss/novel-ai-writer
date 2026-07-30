import { useEffect, useState } from "react";
import { Plus, Save, Trash2, X, Edit3, MapPin } from "lucide-react";
import { useBookStore } from "@/stores/bookStore";
import {
  useSceneCardStore,
  type SceneCard,
  type CreateSceneRequest,
  type UpdateSceneRequest,
} from "@/stores/sceneCardStore";

export function ScenePanel() {
  const { currentBookId } = useBookStore();
  const { scenes, isLoading, loadScenes, createScene, updateScene, deleteScene } = useSceneCardStore();

  const [isEditing, setIsEditing] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [timePeriod, setTimePeriod] = useState("");
  const [atmosphere, setAtmosphere] = useState("");

  useEffect(() => {
    if (currentBookId) {
      loadScenes(currentBookId);
    }
  }, [currentBookId, loadScenes]);

  const resetForm = () => {
    setEditId(null);
    setName("");
    setDescription("");
    setLocation("");
    setTimePeriod("");
    setAtmosphere("");
    setIsEditing(false);
  };

  const startCreate = () => {
    resetForm();
    setIsEditing(true);
  };

  const startEdit = (s: SceneCard) => {
    setEditId(s.id);
    setName(s.name);
    setDescription(s.description);
    setLocation(s.location);
    setTimePeriod(s.timePeriod);
    setAtmosphere(s.atmosphere);
    setIsEditing(true);
  };

  const handleSave = async () => {
    if (!currentBookId || !name.trim()) return;

    if (editId) {
      const req: UpdateSceneRequest = {
        id: editId,
        name: name.trim(),
        description: description.trim(),
        location: location.trim(),
        timePeriod: timePeriod.trim(),
        atmosphere: atmosphere.trim(),
      };
      await updateScene(req);
    } else {
      const req: CreateSceneRequest = {
        bookId: currentBookId,
        name: name.trim(),
        description: description.trim(),
        location: location.trim(),
        timePeriod: timePeriod.trim(),
        atmosphere: atmosphere.trim(),
      };
      await createScene(req);
      if (currentBookId) await loadScenes(currentBookId);
    }
    resetForm();
  };

  if (!currentBookId) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-3 text-sm text-muted-foreground">
        <MapPin size={24} className="mb-2 opacity-50" />
        请先选择一本书
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col p-3">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium">场景卡</h3>
        <button
          onClick={startCreate}
          className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:opacity-90"
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
            placeholder="场景名 *"
            className="w-full rounded bg-muted px-2 py-1 text-xs outline-none"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="描述"
            className="w-full rounded bg-muted px-2 py-1 text-xs outline-none"
          />
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="地点"
            className="w-full rounded bg-muted px-2 py-1 text-xs outline-none"
          />
          <input
            type="text"
            value={timePeriod}
            onChange={(e) => setTimePeriod(e.target.value)}
            placeholder="时间"
            className="w-full rounded bg-muted px-2 py-1 text-xs outline-none"
          />
          <input
            type="text"
            value={atmosphere}
            onChange={(e) => setAtmosphere(e.target.value)}
            placeholder="氛围"
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
        ) : scenes.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            <MapPin size={24} className="mx-auto mb-2 opacity-50" />
            暂无场景卡
            <br />
            点击右上角新建
          </div>
        ) : (
          <div className="space-y-2">
            {scenes.map((s) => (
              <div
                key={s.id}
                className="rounded-md border border-panel-border p-2 text-sm hover:bg-muted/50"
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="truncate font-medium">{s.name}</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => startEdit(s)}
                      className="rounded p-1 text-muted-foreground hover:bg-muted"
                      title="编辑"
                    >
                      <Edit3 size={12} />
                    </button>
                    <button
                      onClick={() => deleteScene(s.id)}
                      className="rounded p-1 text-red-500 hover:bg-muted"
                      title="删除"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
                {s.location && <p className="text-xs text-muted-foreground">地点：{s.location}</p>}
                {s.timePeriod && <p className="text-xs text-muted-foreground">时间：{s.timePeriod}</p>}
                {s.atmosphere && <p className="text-xs text-muted-foreground">氛围：{s.atmosphere}</p>}
                {s.description && (
                  <p className="line-clamp-2 text-xs text-muted-foreground">{s.description}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
