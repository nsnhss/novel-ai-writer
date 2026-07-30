import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Sparkles, Check, Star, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { useStyleProfileStore, parseStyleFeatures } from "@/stores/styleProfileStore";
import { useMaterialStore } from "@/stores/materialStore";

export function StyleProfilePanel() {
  const { profiles, activeProfileId, isLoading, error, autoRecalibrate, loadProfiles, loadActiveProfileId, setActiveProfileId, extractProfile, deleteProfile, recalibrateProfile, evaluateDrift, loadAutoRecalibrate, setAutoRecalibrate, clearError } = useStyleProfileStore();
  const { materials, loadMaterials } = useMaterialStore();

  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<Set<string>>(new Set());
  const [isExtracting, setIsExtracting] = useState(false);
  const [isRecalibrating, setIsRecalibrating] = useState(false);
  const [recalibrateResult, setRecalibrateResult] = useState<{ sampleCount: number; avgRating: number; previous: { sentenceLengthAvg: number }; current: { sentenceLengthAvg: number } } | null>(null);
  const [driftText, setDriftText] = useState("");
  const [driftResult, setDriftResult] = useState<{ driftScore: number; interpretation: string } | null>(null);
  const [isEvaluatingDrift, setIsEvaluatingDrift] = useState(false);

  useEffect(() => {
    loadProfiles();
    loadActiveProfileId();
    loadAutoRecalibrate();
    loadMaterials({ statusFilter: "active" });
  }, [loadProfiles, loadActiveProfileId, loadAutoRecalibrate, loadMaterials]);

  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === activeProfileId) || null,
    [profiles, activeProfileId]
  );

  const selectedProfile = useMemo(
    () => profiles.find((p) => p.id === selectedProfileId) || activeProfile,
    [profiles, selectedProfileId, activeProfile]
  );

  const selectedFeatures = useMemo(() => parseStyleFeatures(selectedProfile), [selectedProfile]);

  const activeMaterials = useMemo(
    () => materials.filter((m) => m.status === "active"),
    [materials]
  );

  const toggleMaterial = (id: string) => {
    setSelectedMaterialIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleExtract = async () => {
    const name = newProfileName.trim();
    if (!name || selectedMaterialIds.size === 0) return;
    setIsExtracting(true);
    try {
      await extractProfile({ name, materialIds: Array.from(selectedMaterialIds) });
      setIsCreating(false);
      setNewProfileName("");
      setSelectedMaterialIds(new Set());
    } finally {
      setIsExtracting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定删除该风格画像？")) return;
    await deleteProfile(id);
    if (selectedProfileId === id) setSelectedProfileId(null);
  };

  const handleRecalibrate = async () => {
    const id = selectedProfile?.id ?? activeProfileId;
    if (!id) return;
    setIsRecalibrating(true);
    try {
      const result = await recalibrateProfile(id);
      setRecalibrateResult(result);
    } finally {
      setIsRecalibrating(false);
    }
  };

  const handleEvaluateDrift = async () => {
    if (!driftText.trim()) return;
    setIsEvaluatingDrift(true);
    try {
      const result = await evaluateDrift(driftText.trim());
      setDriftResult(result);
    } finally {
      setIsEvaluatingDrift(false);
    }
  };

  return (
    <div className="flex h-full flex-col p-3">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium">风格画像</h3>
        <button
          onClick={() => setIsCreating((s) => !s)}
          className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:opacity-90"
        >
          <Plus size={12} /> 新建画像
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-md bg-red-500/10 p-2 text-xs text-red-500">
          <div className="flex items-start justify-between gap-2">
            <span>{error}</span>
            <button onClick={clearError} className="shrink-0 text-red-500 hover:opacity-70">×</button>
          </div>
        </div>
      )}

      {isCreating && (
        <div className="mb-3 space-y-2 rounded-md border border-panel-border bg-muted/30 p-3">
          <input
            type="text"
            value={newProfileName}
            onChange={(e) => setNewProfileName(e.target.value)}
            placeholder="画像名称，例如：细腻古风"
            className="w-full rounded bg-muted px-2 py-1 text-xs outline-none"
          />
          <div className="text-xs text-muted-foreground">选择用于提炼风格的 active 素材：</div>
          <div className="max-h-40 overflow-y-auto space-y-1 rounded bg-muted p-2">
            {activeMaterials.length === 0 && (
              <div className="text-xs text-muted-foreground">没有 active 素材，请先导入并激活素材。</div>
            )}
            {activeMaterials.map((m) => (
              <label key={m.id} className="flex items-center gap-2 text-xs hover:bg-muted/50">
                <input
                  type="checkbox"
                  checked={selectedMaterialIds.has(m.id)}
                  onChange={() => toggleMaterial(m.id)}
                  className="h-3 w-3"
                />
                <span className="flex-1 truncate">{m.sourceName || "未命名素材"}</span>
                {m.rating > 0 && (
                  <span className="flex text-[10px] text-yellow-500">
                    {Array.from({ length: m.rating }).map((_, i) => (
                      <Star key={i} size={8} fill="currentColor" />
                    ))}
                  </span>
                )}
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setIsCreating(false);
                setNewProfileName("");
                setSelectedMaterialIds(new Set());
              }}
              className="rounded-md bg-muted px-2 py-1 text-xs hover:bg-muted/80"
            >
              取消
            </button>
            <button
              onClick={handleExtract}
              disabled={!newProfileName.trim() || selectedMaterialIds.size === 0 || isExtracting}
              className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {isExtracting ? <Sparkles size={10} className="animate-spin" /> : <Sparkles size={10} />}
              提取画像
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="py-8 text-center text-sm text-muted-foreground">加载中…</div>
      ) : profiles.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          <BookOpen size={24} className="mx-auto mb-2 opacity-50" />
          暂无风格画像
          <br />
          点击右上角从素材中提取
        </div>
      ) : (
        <div className="flex flex-1 gap-3 overflow-hidden">
          <div className="w-1/2 overflow-y-auto rounded-md border border-panel-border p-2">
            <div className="mb-2 text-xs text-muted-foreground">画像列表</div>
            <div className="space-y-2">
              {profiles.map((p) => (
                <div
                  key={p.id}
                  onClick={() => setSelectedProfileId(p.id)}
                  className={cn(
                    "cursor-pointer rounded-md border border-panel-border p-2 text-sm hover:bg-muted/50",
                    selectedProfileId === p.id && "border-primary bg-primary/5",
                    activeProfileId === p.id && !selectedProfileId && "border-primary/50 bg-primary/5"
                  )}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-medium">{p.name}</span>
                    <div className="flex items-center gap-1">
                      {activeProfileId === p.id && (
                        <span className="flex items-center gap-0.5 text-[10px] text-green-500">
                          <Check size={10} /> 当前应用
                        </span>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(p.id);
                        }}
                        className="rounded p-1 text-red-500 hover:bg-muted"
                        title="删除"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    更新于 {new Date(p.updatedAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex w-1/2 flex-col overflow-hidden rounded-md border border-panel-border p-2">
            {selectedProfile ? (
              <>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium">{selectedProfile.name}</span>
                  <button
                    onClick={() => setActiveProfileId(selectedProfile.id)}
                    disabled={activeProfileId === selectedProfile.id}
                    className={cn(
                      "rounded-md px-2 py-1 text-xs",
                      activeProfileId === selectedProfile.id
                        ? "bg-green-500/10 text-green-500"
                        : "bg-primary px-2 py-1 text-xs text-primary-foreground hover:opacity-90"
                    )}
                  >
                    {activeProfileId === selectedProfile.id ? "已应用" : "应用此画像"}
                  </button>
                </div>

                <div className="mb-2 flex items-center justify-between rounded bg-muted/50 p-2 text-xs">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={autoRecalibrate}
                      onChange={(e) => setAutoRecalibrate(e.target.checked)}
                    />
                    采纳高分生成后自动校准
                  </label>
                  <button
                    onClick={handleRecalibrate}
                    disabled={isRecalibrating}
                    className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    {isRecalibrating ? "校准中..." : "重新校准"}
                  </button>
                </div>

                {recalibrateResult && (
                  <div className="mb-2 rounded bg-muted/50 p-2 text-xs text-muted-foreground">
                    <div>参与样本：{recalibrateResult.sampleCount}，平均评分：{recalibrateResult.avgRating.toFixed(1)}</div>
                    <div>平均句长：{recalibrateResult.previous.sentenceLengthAvg.toFixed(1)} → {recalibrateResult.current.sentenceLengthAvg.toFixed(1)}</div>
                  </div>
                )}

                <div className="mb-2 space-y-1 rounded bg-muted/50 p-2 text-xs">
                  <div className="text-muted-foreground">风格漂移检测</div>
                  <textarea
                    value={driftText}
                    onChange={(e) => setDriftText(e.target.value)}
                    placeholder="粘贴一段生成文本，检测是否与当前画像风格一致"
                    rows={3}
                    className="w-full rounded bg-muted px-2 py-1 text-xs outline-none"
                  />
                  <div className="flex justify-end">
                    <button
                      onClick={handleEvaluateDrift}
                      disabled={isEvaluatingDrift || !driftText.trim()}
                      className="rounded-md bg-muted px-2 py-1 text-xs hover:bg-muted/80 disabled:opacity-50"
                    >
                      {isEvaluatingDrift ? "检测中..." : "检测"}
                    </button>
                  </div>
                  {driftResult && (
                    <div className="text-muted-foreground">
                      相似度：{(driftResult.driftScore * 100).toFixed(1)}% — {driftResult.interpretation}
                    </div>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto space-y-2 text-xs">
                  {selectedFeatures?.description && (
                    <div className="rounded bg-muted/50 p-2">
                      <div className="mb-1 text-muted-foreground">风格描述</div>
                      <div className="whitespace-pre-wrap">{selectedFeatures.description}</div>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2 rounded bg-muted/50 p-2">
                    <div>平均句长: {selectedProfile.sentenceLengthAvg?.toFixed(1) ?? "-"}</div>
                    <div>句长标准差: {selectedProfile.sentenceLengthStd?.toFixed(1) ?? "-"}</div>
                    <div>描写占比: {selectedProfile.descriptionRatio ? `${(selectedProfile.descriptionRatio * 100).toFixed(1)}%` : "-"}</div>
                    <div>对话占比: {selectedProfile.dialogueRatio ? `${(selectedProfile.dialogueRatio * 100).toFixed(1)}%` : "-"}</div>
                  </div>
                  {selectedFeatures?.topKeywords && selectedFeatures.topKeywords.length > 0 && (
                    <div className="rounded bg-muted/50 p-2">
                      <div className="mb-1 text-muted-foreground">高频词</div>
                      <div className="flex flex-wrap gap-1">
                        {selectedFeatures.topKeywords.slice(0, 20).map((word) => (
                          <span key={word} className="rounded bg-muted px-1.5 py-0.5">{word}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {selectedFeatures?.sexStyleFingerprint && (
                    <div className="rounded bg-muted/50 p-2">
                      <div className="mb-1 text-muted-foreground">性爱写作指纹</div>
                      <div className="space-y-1 text-[10px] text-muted-foreground">
                        {Object.keys(selectedFeatures.sexStyleFingerprint.femalePartTerms).length > 0 && (
                          <div>
                            女性部位偏好：
                            {Object.entries(selectedFeatures.sexStyleFingerprint.femalePartTerms)
                              .sort((a, b) => b[1] - a[1])
                              .slice(0, 5)
                              .map(([k, v]) => `${k}(${(v * 100).toFixed(0)}%)`)
                              .join("、")}
                          </div>
                        )}
                        {Object.keys(selectedFeatures.sexStyleFingerprint.malePartTerms).length > 0 && (
                          <div>
                            男性部位偏好：
                            {Object.entries(selectedFeatures.sexStyleFingerprint.malePartTerms)
                              .sort((a, b) => b[1] - a[1])
                              .slice(0, 5)
                              .map(([k, v]) => `${k}(${(v * 100).toFixed(0)}%)`)
                              .join("、")}
                          </div>
                        )}
                        <div>
                          脏话使用率：{selectedFeatures.sexStyleFingerprint.dirtyWordUsage.toFixed(1)}‰；
                          体位详细度：{selectedFeatures.sexStyleFingerprint.positionDetailLevel.toFixed(2)}；
                          事后占比：{selectedFeatures.sexStyleFingerprint.aftercareRatio.toFixed(2)}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                选择一个画像查看详情
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
