import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Bot,
  Search,
  Settings,
  LayoutTemplate,
  UserRound,
  MapPin,
  Anchor,
  Palette,
  AlertTriangle,
  Send,
  Square,
  RefreshCw,
  Star,
  Check,
  X,
  Copy,
  Plus,
  Trash2,
  Sparkles,
  GitBranch,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUIStore, type RightPanelTab } from "@/stores/uiStore";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { SceneTemplatePanel } from "@/components/templates/SceneTemplatePanel";
import { CharacterPanel } from "@/components/characters/CharacterPanel";
import { ScenePanel } from "@/components/scenes/ScenePanel";
import { AnchorPanel } from "@/components/anchors/AnchorPanel";
import { MaterialPanel } from "@/components/materials/MaterialPanel";
import { StyleProfilePanel } from "@/components/styleProfile/StyleProfilePanel";
import { OutlineDialog } from "@/components/ai/OutlineDialog";
import { useBookStore } from "@/stores/bookStore";
import { useMaterialStore } from "@/stores/materialStore";
import { useContextStore } from "@/stores/contextStore";
import { useGenerationStore } from "@/stores/generationStore";
import { useGenerationHistoryStore } from "@/stores/generationHistoryStore";
import { useModelStore } from "@/stores/modelStore";
import { useSceneTemplateStore } from "@/stores/sceneTemplateStore";
import { useAppConfigStore } from "@/stores/appConfigStore";
import { useBranchGenerationStore } from "@/stores/branchGenerationStore";
import { getEditorRef } from "@/lib/editorRef";
import { toast } from "@/lib/toast";

const tabs: { id: RightPanelTab; label: string; icon: LucideIcon }[] = [
  { id: "ai", label: "AI", icon: Bot },
  { id: "material", label: "素材", icon: Search },
  { id: "template", label: "模板", icon: LayoutTemplate },
  { id: "character", label: "角色", icon: UserRound },
  { id: "scene", label: "场景", icon: MapPin },
  { id: "anchor", label: "锚点", icon: Anchor },
  { id: "styleProfile", label: "风格", icon: Palette },
  { id: "settings", label: "设置", icon: Settings },
];

function AIPanel() {
  const { currentBookId, currentChapterId, currentDocNode, volumes, loadBookTree } = useBookStore();
  const { currentContext, isLoading: isContextLoading, error: contextError, previewContext } = useContextStore();
  const {
    isGenerating,
    generatedText,
    inputTokens,
    outputTokens,
    currentLogId,
    error: genError,
    params,
    pendingRagQuery,
    startContinue,
    abortGeneration,
    acceptGeneration,
    rejectGeneration,
    loadParams,
    setParams,
    saveParams,
    consumePendingRagQuery,
    reset,
  } = useGenerationStore();
  const { tags, loadTags, loadMaterials } = useMaterialStore();
  const { history, loadHistory } = useGenerationHistoryStore();
  const { openDialog: openBranchDialog } = useBranchGenerationStore();
  const { currentModel, models, loadModels, loadCurrentModel, switchModel } = useModelStore();
  const { templates, loadTemplates } = useSceneTemplateStore();
  const { adultMode, loadAdultMode } = useAppConfigStore();
  const [ragQuery, setRagQuery] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [isGeneratingBeats, setIsGeneratingBeats] = useState(false);

  const visibleTemplates = useMemo(
    () => templates.filter((t) => adultMode || !t.isAdult),
    [templates, adultMode]
  );

  useEffect(() => {
    if (selectedTemplateId && !adultMode) {
      const selected = templates.find((t) => t.id === selectedTemplateId);
      if (selected?.isAdult) {
        setSelectedTemplateId("");
      }
    }
  }, [adultMode, templates, selectedTemplateId]);
  const [showOutlineDialog, setShowOutlineDialog] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [rating, setRating] = useState(3);
  const [contentLevel, setContentLevel] = useState("general");
  const [selectedContentLevels, setSelectedContentLevels] = useState<string[]>(["general"]);
  const [diagnosticDimensions, setDiagnosticDimensions] = useState<{ key: string; name: string }[]>([]);
  const [diagnosticResults, setDiagnosticResults] = useState<{ key: string; name: string; suggestion: string }[] | null>(null);
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [selectedDiagnosticKeys, setSelectedDiagnosticKeys] = useState<string[]>([]);
  const [consistencyWarnings, setConsistencyWarnings] = useState<{ warningType: string; description: string; quote: string }[] | null>(null);
  const [isCheckingConsistency, setIsCheckingConsistency] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadModels();
    loadCurrentModel();
    loadTags();
    loadParams();
    loadTemplates();
    loadAdultMode();
    invoke<{ key: string; name: string }[]>("get_diagnostic_dimensions")
      .then((dims) => {
        setDiagnosticDimensions(dims);
        setSelectedDiagnosticKeys(dims.map((d) => d.key));
      })
      .catch(() => setDiagnosticDimensions([]));
  }, [loadModels, loadCurrentModel, loadTags, loadParams, loadTemplates, loadAdultMode]);

  useEffect(() => {
    loadHistory(currentChapterId ?? "");
  }, [currentChapterId, loadHistory]);

  useEffect(() => {
    if (pendingRagQuery) {
      setRagQuery(pendingRagQuery);
      consumePendingRagQuery();
    }
  }, [pendingRagQuery, consumePendingRagQuery]);

  const totalBudget = 6000;
  const usedTokens = currentContext?.tokenCounts.total ?? 0;
  const usagePercent = Math.min((usedTokens / totalBudget) * 100, 100);

  const contentLevelOptions = useMemo(() => {
    const fromTags = tags.filter((t) => t.category === "content_level").map((t) => t.name);
    const base = ["general", ...fromTags];
    return Array.from(new Set(base));
  }, [tags]);

  const toggleContentLevel = (level: string) => {
    setSelectedContentLevels((prev) =>
      prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level]
    );
  };

  const handlePreviewContext = async () => {
    if (!currentBookId || !currentChapterId) return;
    await previewContext({
      bookId: currentBookId,
      chapterId: currentChapterId,
      cursorPrefix: currentDocNode?.content ?? "",
      ragQuery: ragQuery || (currentDocNode?.content?.slice(-200) ?? ""),
      maxRagChunks: 3,
      contentLevels: selectedContentLevels,
      sceneTemplateId: selectedTemplateId || undefined,
    });
  };

  const handleBranchContinue = () => {
    if (!currentBookId || !currentChapterId) return;
    const editor = getEditorRef();
    if (!editor) return;

    const range = editor.getSelectionRange();
    const text = editor.getText();
    const cursorPrefix = text.slice(0, range.from);

    openBranchDialog({
      bookId: currentBookId,
      chapterId: currentChapterId,
      cursorPrefix,
      ragQuery: ragQuery || cursorPrefix.slice(-200),
      contentLevels: selectedContentLevels,
      sceneTemplateId: selectedTemplateId || undefined,
      temperature: params.temperature,
      topP: params.topP,
      topK: params.topK,
      repetitionPenalty: params.repetitionPenalty,
      frequencyPenalty: params.frequencyPenalty,
      maxTokens: params.maxTokens,
    });
  };

  const handleContinue = async () => {
    if (!currentBookId || !currentChapterId) return;
    const editor = getEditorRef();
    if (!editor) return;

    reset();
    editor.startGeneration();
    setShowActions(true);

    const logId = await startContinue(
      {
        bookId: currentBookId,
        chapterId: currentChapterId,
        cursorPrefix: currentDocNode?.content ?? "",
        ragQuery: ragQuery || (currentDocNode?.content?.slice(-200) ?? ""),
        contentLevels: selectedContentLevels,
        requestType: "continue",
        temperature: params.temperature,
        topP: params.topP,
        topK: params.topK,
        repetitionPenalty: params.repetitionPenalty,
        frequencyPenalty: params.frequencyPenalty,
        maxTokens: params.maxTokens,
        sceneTemplateId: selectedTemplateId || undefined,
      },
      {
        onStart: () => {
          setConsistencyWarnings(null);
          setDiagnosticResults(null);
        },
        onToken: (token) => {
          editor.appendGenerationToken(token);
        },
        onUsage: () => {},
        onError: () => {
          // 保留已生成的部分内容，用户可通过工具条接受或拒绝
          editor.finishGeneration();
          setRating(3);
        },
        onDone: () => {
          const text = useGenerationStore.getState().generatedText;
          handleCheckConsistency(text);
        },
      }
    );

    if (logId) {
      setShowActions(true);
    } else {
      setShowActions(false);
      setRating(3);
    }
  };

  const currentVolume = volumes.find((v) => v.chapters?.some((c) => c.id === currentChapterId));

  const handleSummarizeChapter = async () => {
    if (!currentChapterId) return;
    setIsSummarizing(true);
    try {
      await invoke("summarize_chapter", { chapterId: currentChapterId });
      if (currentBookId) await loadBookTree(currentBookId);
    } catch (err) {
      console.error("生成章摘要失败:", err);
      toast.error(`生成章摘要失败: ${String(err)}`);
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleSummarizeVolume = async () => {
    if (!currentVolume?.id) return;
    setIsSummarizing(true);
    try {
      await invoke("summarize_volume", { volumeId: currentVolume.id });
      if (currentBookId) await loadBookTree(currentBookId);
    } catch (err) {
      console.error("生成卷摘要失败:", err);
      toast.error(`生成卷摘要失败: ${String(err)}`);
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleSummarizeBook = async () => {
    if (!currentBookId) return;
    setIsSummarizing(true);
    try {
      await invoke("summarize_book", { bookId: currentBookId });
      if (currentBookId) await loadBookTree(currentBookId);
    } catch (err) {
      console.error("生成全书摘要失败:", err);
      toast.error(`生成全书摘要失败: ${String(err)}`);
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleGenerateBeats = async () => {
    if (!currentBookId || !currentChapterId || !selectedTemplateId) return;
    setIsGeneratingBeats(true);
    try {
      const text = await invoke<string>("stream_generate_beats", {
        req: {
          bookId: currentBookId,
          chapterId: currentChapterId,
          cursorPrefix: currentDocNode?.content ?? "",
          ragQuery: ragQuery || (currentDocNode?.content?.slice(-200) ?? ""),
          contentLevels: selectedContentLevels,
          requestType: "continue",
          temperature: params.temperature,
          topP: params.topP,
          topK: params.topK,
          repetitionPenalty: params.repetitionPenalty,
          frequencyPenalty: params.frequencyPenalty,
          maxTokens: params.maxTokens,
          sceneTemplateId: selectedTemplateId,
        },
      });
      getEditorRef()?.insertText(text);
    } catch (err) {
      toast.error(`节拍生成失败: ${err}`);
    } finally {
      setIsGeneratingBeats(false);
    }
  };

  const handleDiagnose = async (text: string) => {
    if (!text.trim() || selectedDiagnosticKeys.length === 0) return;
    setIsDiagnosing(true);
    try {
      const results = await invoke<{ key: string; name: string; suggestion: string }[]>("diagnose_text", {
        req: { text, dimensionKeys: selectedDiagnosticKeys },
      });
      setDiagnosticResults(results);
    } catch (err) {
      toast.error(`诊断失败: ${err}`);
    } finally {
      setIsDiagnosing(false);
    }
  };

  const handleCheckConsistency = async (text: string) => {
    if (!text.trim() || !currentChapterId) return;
    setIsCheckingConsistency(true);
    try {
      const warnings = await invoke<{ warningType: string; description: string; quote: string }[]>("detect_generation_inconsistencies", {
        req: { chapterId: currentChapterId, text },
      });
      setConsistencyWarnings(warnings);
    } catch (err) {
      console.error("一致性检测失败:", err);
    } finally {
      setIsCheckingConsistency(false);
    }
  };

  const handleAccept = async () => {
    try {
      await acceptGeneration({ rating, contentLevel, sourceName: "AI 续写" });
      await loadMaterials();
    } catch (err) {
      console.error("入库失败:", err);
    } finally {
      setShowActions(false);
      setRating(3);
      setContentLevel("general");
    }
  };

  const handleReject = async () => {
    // 拒绝会移除已生成文本且不可恢复，二次确认防误点
    if (!window.confirm("确定拒绝此次生成？已生成内容将被移除。")) return;
    try {
      await rejectGeneration(rating);
    } finally {
      setShowActions(false);
      setRating(3);
      setContentLevel("general");
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto p-3">
        <div className="mb-4 rounded-lg bg-muted p-3 text-sm">
          <p className="text-muted-foreground">
            AI 助手已就绪。点击"续写"从光标处流式生成，或先预览上下文与 Token 预算。
          </p>
        </div>

        <div className="mb-4 space-y-2">
          <input
            type="text"
            value={ragQuery}
            onChange={(e) => setRagQuery(e.target.value)}
            placeholder="RAG 检索关键词（留空使用光标前 200 字）"
            className="w-full rounded-md bg-muted px-3 py-2 text-sm outline-none ring-ring focus:ring-1"
          />
          <button
            onClick={handlePreviewContext}
            disabled={isContextLoading || !currentBookId || !currentChapterId}
            className="w-full rounded-md bg-muted px-3 py-2 text-sm hover:bg-muted/80 disabled:opacity-50"
          >
            {isContextLoading ? "组装中…" : "预览上下文与 Token 预算"}
          </button>
          <div className="flex flex-wrap gap-2">
            {contentLevelOptions.map((level) => (
              <label
                key={level}
                className="flex cursor-pointer items-center gap-1 rounded bg-muted px-2 py-1 text-xs"
              >
                <input
                  type="checkbox"
                  checked={selectedContentLevels.includes(level)}
                  onChange={() => toggleContentLevel(level)}
                  className="h-3 w-3"
                />
                {level}
              </label>
            ))}
          </div>

          {adultMode && contentLevelOptions.some((l) => l !== "general" && l !== "inspiration") && (
            <label className="flex cursor-pointer items-center gap-2 rounded bg-muted/50 px-2 py-1 text-xs">
              <input
                type="checkbox"
                checked={contentLevelOptions
                  .filter((l) => l !== "general" && l !== "inspiration")
                  .every((l) => selectedContentLevels.includes(l))}
                onChange={() => {
                  const adultLevels = contentLevelOptions.filter((l) => l !== "general" && l !== "inspiration");
                  const allSelected = adultLevels.every((l) => selectedContentLevels.includes(l));
                  if (allSelected) {
                    setSelectedContentLevels((prev) => prev.filter((l) => !adultLevels.includes(l)));
                  } else {
                    setSelectedContentLevels((prev) => Array.from(new Set([...prev, ...adultLevels])));
                  }
                }}
                className="h-3 w-3"
              />
              包含成人级别素材
            </label>
          )}

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">场景模板</label>
            <select
              value={selectedTemplateId}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
              className="w-full rounded-md bg-muted px-2 py-1.5 text-xs outline-none"
            >
              <option value="">无</option>
              {visibleTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            {selectedTemplateId && (() => {
              const t = visibleTemplates.find((x) => x.id === selectedTemplateId);
              const beatCount = t?.beats ? (() => { try { return (JSON.parse(t.beats) as unknown[]).length; } catch { return 0; } })() : 0;
              return beatCount > 0 ? (
                <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span>包含 {beatCount} 个节拍</span>
                  <button
                    onClick={handleGenerateBeats}
                    disabled={isGeneratingBeats || !currentBookId || !currentChapterId}
                    className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    {isGeneratingBeats ? "生成中..." : "按节拍生成"}
                  </button>
                </div>
              ) : null;
            })()}
          </div>

          <div className="rounded-md border border-panel-border p-2">
            <div className="mb-2 text-xs font-medium text-muted-foreground">生成参数</div>
            <div className="space-y-2">
              <ParamRow
                label="温度"
                min={0}
                max={2}
                step={0.1}
                value={params.temperature}
                onChange={(value) => {
                  setParams({ temperature: value });
                  saveParams();
                }}
              />
              <ParamRow
                label="Top P"
                min={0}
                max={1}
                step={0.05}
                value={params.topP}
                onChange={(value) => {
                  setParams({ topP: value });
                  saveParams();
                }}
              />
              <ParamRow
                label="Top K"
                min={0}
                max={100}
                step={1}
                value={params.topK}
                onChange={(value) => {
                  setParams({ topK: value });
                  saveParams();
                }}
              />
              <ParamRow
                label="重复惩罚"
                min={0.5}
                max={2}
                step={0.05}
                value={params.repetitionPenalty}
                onChange={(value) => {
                  setParams({ repetitionPenalty: value });
                  saveParams();
                }}
              />
              <ParamRow
                label="频率惩罚"
                min={-2}
                max={2}
                step={0.1}
                value={params.frequencyPenalty}
                onChange={(value) => {
                  setParams({ frequencyPenalty: value });
                  saveParams();
                }}
              />
              <ParamRow
                label="最大 Token"
                min={100}
                max={16000}
                step={100}
                value={params.maxTokens}
                onChange={(value) => {
                  setParams({ maxTokens: value });
                  saveParams();
                }}
              />
            </div>
          </div>

          <div className="rounded-md border border-panel-border p-2">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-medium text-muted-foreground">感官权重</div>
              <button
                onClick={() => {
                  setParams({ sensoryWeights: { visual: 20, tactile: 20, auditory: 20, olfactory: 20, mental: 20 } });
                  saveParams();
                }}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                重置平均
              </button>
            </div>
            <div className="space-y-2">
              <ParamRow
                label="视觉"
                min={0}
                max={100}
                step={1}
                value={params.sensoryWeights.visual}
                onChange={(value) => {
                  setParams({ sensoryWeights: { ...params.sensoryWeights, visual: value } });
                  saveParams();
                }}
              />
              <ParamRow
                label="触觉"
                min={0}
                max={100}
                step={1}
                value={params.sensoryWeights.tactile}
                onChange={(value) => {
                  setParams({ sensoryWeights: { ...params.sensoryWeights, tactile: value } });
                  saveParams();
                }}
              />
              <ParamRow
                label="听觉"
                min={0}
                max={100}
                step={1}
                value={params.sensoryWeights.auditory}
                onChange={(value) => {
                  setParams({ sensoryWeights: { ...params.sensoryWeights, auditory: value } });
                  saveParams();
                }}
              />
              <ParamRow
                label="嗅觉"
                min={0}
                max={100}
                step={1}
                value={params.sensoryWeights.olfactory}
                onChange={(value) => {
                  setParams({ sensoryWeights: { ...params.sensoryWeights, olfactory: value } });
                  saveParams();
                }}
              />
              <ParamRow
                label="心理感受"
                min={0}
                max={100}
                step={1}
                value={params.sensoryWeights.mental}
                onChange={(value) => {
                  setParams({ sensoryWeights: { ...params.sensoryWeights, mental: value } });
                  saveParams();
                }}
              />
            </div>
          </div>

          <div className="rounded-md border border-panel-border p-2">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-medium text-muted-foreground">氛围调色板</div>
              <button
                onClick={() => {
                  setParams({ atmosphere: { gentleRough: 0, implicitExplicit: 0, romanticPrimitive: 0, mentalAction: 0, slowFast: 0 } });
                  saveParams();
                }}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                重置中性
              </button>
            </div>
            <div className="space-y-2">
              <AtmosphereRow
                leftLabel="轻柔"
                rightLabel="粗暴"
                value={params.atmosphere.gentleRough}
                onChange={(value) => {
                  setParams({ atmosphere: { ...params.atmosphere, gentleRough: value } });
                  saveParams();
                }}
              />
              <AtmosphereRow
                leftLabel="含蓄"
                rightLabel="直白"
                value={params.atmosphere.implicitExplicit}
                onChange={(value) => {
                  setParams({ atmosphere: { ...params.atmosphere, implicitExplicit: value } });
                  saveParams();
                }}
              />
              <AtmosphereRow
                leftLabel="浪漫"
                rightLabel="原始"
                value={params.atmosphere.romanticPrimitive}
                onChange={(value) => {
                  setParams({ atmosphere: { ...params.atmosphere, romanticPrimitive: value } });
                  saveParams();
                }}
              />
              <AtmosphereRow
                leftLabel="心理"
                rightLabel="动作"
                value={params.atmosphere.mentalAction}
                onChange={(value) => {
                  setParams({ atmosphere: { ...params.atmosphere, mentalAction: value } });
                  saveParams();
                }}
              />
              <AtmosphereRow
                leftLabel="慢"
                rightLabel="快"
                value={params.atmosphere.slowFast}
                onChange={(value) => {
                  setParams({ atmosphere: { ...params.atmosphere, slowFast: value } });
                  saveParams();
                }}
              />
            </div>
          </div>
        </div>

        {contextError && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-500">
            {contextError}
          </div>
        )}

        {currentContext && (
          <div className="space-y-3 text-sm">
            <div>
              <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>Token 预算</span>
                <span>{usedTokens} / {totalBudget}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    usagePercent > 90 ? "bg-red-500" : usagePercent > 70 ? "bg-yellow-500" : "bg-green-500"
                  )}
                  style={{ width: `${usagePercent}%` }}
                />
              </div>
            </div>

            <div className="rounded-lg border border-panel-border">
              <div className="border-b border-panel-border px-3 py-2 text-xs font-medium">分区明细</div>
              <div className="divide-y divide-panel-border text-xs">
                <TokenCountRow label="系统指令" count={currentContext.tokenCounts.systemPrompt} />
                <TokenCountRow label="风格画像" count={currentContext.tokenCounts.styleProfile} />
                <TokenCountRow label="锚点信息" count={currentContext.tokenCounts.anchors} />
                <TokenCountRow label="角色卡" count={currentContext.tokenCounts.characters} />
                <TokenCountRow label="场景卡" count={currentContext.tokenCounts.scenes} />
                <TokenCountRow label="卷摘要" count={currentContext.tokenCounts.volumeSummary} />
                <TokenCountRow label="章摘要" count={currentContext.tokenCounts.chapterSummaries} />
                <TokenCountRow label="RAG 素材" count={currentContext.tokenCounts.ragChunks} />
                <TokenCountRow label="光标前文" count={currentContext.tokenCounts.cursorPrefix} />
              </div>
            </div>

            {currentContext.truncationWarnings && currentContext.truncationWarnings.length > 0 && (
              <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3">
                <div className="mb-1 flex items-center gap-1 text-xs font-medium text-yellow-500">
                  <AlertTriangle size={12} /> Token 截断提示
                </div>
                <ul className="list-inside list-disc space-y-0.5 text-xs text-yellow-500/90">
                  {currentContext.truncationWarnings.map((warning, idx) => (
                    <li key={idx}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}

            {currentContext.ragChunks.length > 0 && (
              <div className="rounded-lg border border-panel-border">
                <div className="border-b border-panel-border px-3 py-2 text-xs font-medium">
                  RAG 参考片段（{currentContext.ragChunks.length}）
                </div>
                <div className="max-h-40 overflow-y-auto p-2">
                  {currentContext.ragChunks.map((chunk, idx) => (
                    <div key={idx} className="mb-2 text-xs text-muted-foreground last:mb-0">
                      <div className="mb-0.5 flex justify-between">
                        <span>素材 {chunk.materialId.slice(0, 8)}</span>
                        <span>距离 {chunk.distance.toFixed(3)}</span>
                      </div>
                      <p className="line-clamp-3">{chunk.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-panel-border p-3">
        {genError && (
          <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-500">
            <p className="font-medium mb-1">生成失败</p>
            <p className="max-h-32 overflow-auto whitespace-pre-wrap">{genError}</p>
            <p className="mt-2 text-red-400">请检查：模型是否已选择、API Key 是否已配置、网络是否畅通</p>
          </div>
        )}

        {/* currentLogId 由 generationStore 维护：在编辑器工具条接受/拒绝后会重置为 null，此处同步隐藏 */}
        {showActions && !isGenerating && currentLogId && (
          <div className="mb-3 space-y-2">
            <div className="flex items-center justify-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => setRating(star)}
                  className={cn(
                    "rounded p-0.5",
                    rating >= star ? "text-yellow-500" : "text-muted-foreground/30"
                  )}
                >
                  <Star size={16} fill={rating >= star ? "currentColor" : "none"} />
                </button>
              ))}
            </div>
            <select
              value={contentLevel}
              onChange={(e) => setContentLevel(e.target.value)}
              className="w-full rounded-md bg-muted px-2 py-1.5 text-xs outline-none"
            >
              <option value="general">通用</option>
              <option value="inspiration">灵感/梗</option>
              <option value="style">文风参考</option>
              <option value="outline">大纲/设定</option>
              <option value="character">人物卡</option>
              <option value="scene">场景卡</option>
            </select>
            <div className="flex gap-2">
              <button
                onClick={handleAccept}
                className="flex flex-1 items-center justify-center gap-1 rounded-md bg-green-600 px-3 py-2 text-sm text-white hover:bg-green-700"
              >
                <Check size={14} /> 接受并入库
              </button>
              <button
                onClick={handleReject}
                className="flex flex-1 items-center justify-center gap-1 rounded-md bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-700"
              >
                <X size={14} /> 拒绝
              </button>
            </div>
          </div>
        )}

        {isCheckingConsistency && (
          <div className="mb-3 rounded-md border border-yellow-500/30 bg-yellow-500/10 p-2 text-xs text-yellow-600">
            <span className="flex items-center gap-1"><RefreshCw size={12} className="animate-spin" /> 正在检查设定一致性...</span>
          </div>
        )}

        {consistencyWarnings && consistencyWarnings.length > 0 && (
          <div className="mb-3 rounded-md border border-yellow-500/30 bg-yellow-500/10 p-2 text-xs">
            <div className="mb-2 flex items-center justify-between font-medium text-yellow-600">
              <span className="flex items-center gap-1"><AlertTriangle size={12} /> 发现 {consistencyWarnings.length} 处不一致</span>
              <button
                onClick={() => setConsistencyWarnings(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                忽略
              </button>
            </div>
            <div className="space-y-1">
              {consistencyWarnings.map((w, idx) => {
                const typeLabel: Record<string, string> = {
                  anchor: "锚点",
                  character: "角色",
                  scene: "场景",
                  body: "身体状态",
                };
                return (
                  <div key={idx} className="rounded bg-muted/50 p-1.5">
                    <div className="font-medium">{typeLabel[w.warningType] ?? w.warningType}：{w.description}</div>
                    {w.quote && <div className="mt-0.5 text-muted-foreground">“{w.quote}”</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {adultMode && diagnosticDimensions.length > 0 && (
          <div className="mb-3 rounded-md border border-panel-border p-2 text-xs">
            <div className="mb-2 font-medium text-muted-foreground">成人内容诊断</div>
            <div className="mb-2 flex flex-wrap gap-1">
              {diagnosticDimensions.map((dim) => (
                <label
                  key={dim.key}
                  className="flex cursor-pointer items-center gap-1 rounded bg-muted px-1.5 py-0.5"
                >
                  <input
                    type="checkbox"
                    checked={selectedDiagnosticKeys.includes(dim.key)}
                    onChange={() => {
                      setSelectedDiagnosticKeys((prev) =>
                        prev.includes(dim.key) ? prev.filter((k) => k !== dim.key) : [...prev, dim.key]
                      );
                    }}
                    className="h-3 w-3"
                  />
                  {dim.name}
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => handleDiagnose(generatedText)}
                disabled={isDiagnosing || !generatedText.trim()}
                className="flex flex-1 items-center justify-center rounded-md bg-muted px-2 py-1.5 hover:bg-muted/80 disabled:opacity-50"
              >
                {isDiagnosing ? "诊断中..." : "诊断生成内容"}
              </button>
              <button
                onClick={() => handleDiagnose(currentDocNode?.content ?? "")}
                disabled={isDiagnosing || !currentDocNode?.content?.trim()}
                className="flex flex-1 items-center justify-center rounded-md bg-muted px-2 py-1.5 hover:bg-muted/80 disabled:opacity-50"
              >
                诊断当前段落
              </button>
            </div>
            {diagnosticResults && (
              <div className="mt-2 space-y-1">
                {diagnosticResults.map((r) => (
                  <div key={r.key} className="rounded bg-muted/50 p-1.5">
                    <span className="font-medium">{r.name}：</span>
                    <span className="text-muted-foreground">{r.suggestion}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="mb-2 flex items-center gap-2">
          <select
            value={currentModel?.id ?? ""}
            onChange={(e) => switchModel(e.target.value)}
            disabled={isGenerating || models.length === 0}
            className="flex-1 rounded-md bg-muted px-2 py-1.5 text-xs outline-none disabled:opacity-50"
          >
            {models.length === 0 && <option value="">未配置模型</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {currentModel ? currentModel.modelName : "—"}
          </span>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setShowOutlineDialog(true)}
            disabled={!currentBookId || !currentChapterId || !currentModel}
            className="flex flex-1 items-center justify-center gap-1 rounded-md bg-muted px-3 py-2 text-sm hover:bg-muted/80 disabled:opacity-50"
          >
            生成大纲
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={handleSummarizeChapter}
            disabled={isSummarizing || !currentChapterId || !currentModel}
            className="flex items-center justify-center gap-1 rounded-md bg-muted px-2 py-2 text-xs hover:bg-muted/80 disabled:opacity-50"
          >
            <Sparkles size={12} /> 章摘要
          </button>
          <button
            onClick={handleSummarizeVolume}
            disabled={isSummarizing || !currentVolume?.id || !currentModel}
            className="flex items-center justify-center gap-1 rounded-md bg-muted px-2 py-2 text-xs hover:bg-muted/80 disabled:opacity-50"
          >
            <Sparkles size={12} /> 卷摘要
          </button>
          <button
            onClick={handleSummarizeBook}
            disabled={isSummarizing || !currentBookId || !currentModel}
            className="flex items-center justify-center gap-1 rounded-md bg-muted px-2 py-2 text-xs hover:bg-muted/80 disabled:opacity-50"
          >
            <Sparkles size={12} /> 全书摘要
          </button>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleContinue}
            disabled={isGenerating || !currentBookId || !currentChapterId || !currentModel}
            className="flex flex-1 items-center justify-center gap-1 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {isGenerating ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
            {isGenerating ? "生成中…" : "续写"}
          </button>
          {isGenerating && (
            <button
              onClick={abortGeneration}
              className="flex items-center gap-1 rounded-md bg-muted px-3 py-2 text-sm hover:bg-muted/80"
            >
              <Square size={14} /> 中断
            </button>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleBranchContinue}
            disabled={!currentBookId || !currentChapterId || !currentModel}
            className="flex flex-1 items-center justify-center gap-1 rounded-md bg-muted px-3 py-2 text-sm hover:bg-muted/80 disabled:opacity-50"
          >
            <GitBranch size={14} /> 多分支续写
          </button>
        </div>

        {(inputTokens > 0 || outputTokens > 0) && (
          <div className="mt-2 flex justify-between text-xs text-muted-foreground">
            <span>输入 tokens: {inputTokens}</span>
            <span>输出 tokens: {outputTokens}</span>
          </div>
        )}

        {history.length > 0 && (
          <div className="mt-4 rounded-lg border border-panel-border">
            <div className="border-b border-panel-border px-3 py-2 text-xs font-medium">生成历史</div>
            <div className="max-h-60 overflow-y-auto p-2 space-y-2">
              {(() => {
                const groups = new Map<string | undefined, typeof history>();
                for (const h of history) {
                  const list = groups.get(h.groupId) ?? [];
                  list.push(h);
                  groups.set(h.groupId, list);
                }
                const flat = Array.from(groups.entries()).sort((a, b) => {
                  const aTime = a[1][0]?.createdAt ?? "";
                  const bTime = b[1][0]?.createdAt ?? "";
                  return bTime.localeCompare(aTime);
                });
                return flat.map(([groupId, items]) => {
                  if (!groupId || items.length === 1) {
                    return items.map((h) => <HistoryItemCard key={h.id} item={h} />);
                  }
                  const isExpanded = expandedGroups.has(groupId);
                  const accepted = items.find((h) => h.accepted);
                  return (
                    <div key={groupId} className="rounded bg-muted/50 p-2 text-xs">
                      <button
                        onClick={() =>
                          setExpandedGroups((prev) => {
                            const next = new Set(prev);
                            if (next.has(groupId)) next.delete(groupId);
                            else next.add(groupId);
                            return next;
                          })
                        }
                        className="flex w-full items-center justify-between"
                      >
                        <span className="text-muted-foreground">
                          多分支续写 · {items.length} 个候选 · {new Date(items[0].createdAt).toLocaleString()}
                          {accepted && <span className="ml-1 text-green-500">(已采用 {String.fromCharCode(65 + accepted.branchIndex)})</span>}
                        </span>
                        <ChevronRight
                          size={12}
                          className={cn("text-muted-foreground transition-transform", isExpanded && "rotate-90")}
                        />
                      </button>
                      {isExpanded && (
                        <div className="mt-2 space-y-2 border-t border-panel-border pt-2">
                          {items.map((h) => (
                            <HistoryItemCard key={h.id} item={h} branchLabel={String.fromCharCode(65 + h.branchIndex)} />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}
      </div>
      <OutlineDialog open={showOutlineDialog} onClose={() => setShowOutlineDialog(false)} />
    </div>
  );
}

function TokenCountRow({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span>{count}</span>
    </div>
  );
}

function HistoryItemCard({ item, branchLabel }: { item: import("@/stores/generationHistoryStore").GenerationHistoryItem; branchLabel?: string }) {
  const { deleteHistory } = useGenerationHistoryStore();
  return (
    <div className="rounded bg-muted p-2 text-xs">
      <div className="mb-1 flex items-center justify-between text-muted-foreground">
        <span>
          {item.requestType === "continue" && "续写"}
          {item.requestType === "rewrite" && "改写"}
          {item.requestType === "outline" && "大纲"}
          {branchLabel && <span className="ml-1 text-primary">分支 {branchLabel}</span>}
          {" · "}
          {new Date(item.createdAt).toLocaleString()}
        </span>
        <span className={item.accepted ? "text-green-500" : "text-red-500"}>
          {item.accepted ? "已接受" : "已拒绝"}
        </span>
      </div>
      <p className="line-clamp-3 mb-2 whitespace-pre-wrap text-foreground/90">{item.content}</p>
      <div className="flex items-center gap-1">
        <button
          onClick={() => navigator.clipboard?.writeText(item.content).catch(console.error)}
          className="rounded p-1 text-muted-foreground hover:bg-background"
          title="复制"
        >
          <Copy size={12} />
        </button>
        <button
          onClick={() => getEditorRef()?.insertText(item.content)}
          className="rounded p-1 text-muted-foreground hover:bg-background"
          title="插入到光标处"
        >
          <Plus size={12} />
        </button>
        <button
          onClick={() => {
            if (window.confirm("确定删除这条生成记录？")) deleteHistory(item.id);
          }}
          className="rounded p-1 text-muted-foreground hover:bg-background"
          title="删除记录"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

function AtmosphereRow({
  leftLabel,
  rightLabel,
  value,
  onChange,
}: {
  leftLabel: string;
  rightLabel: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1 text-xs">
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={-50}
          max={50}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-1 flex-1 cursor-pointer appearance-none rounded bg-muted accent-primary"
        />
        <input
          type="number"
          min={-50}
          max={50}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-12 rounded bg-muted px-1 py-1 text-right outline-none"
        />
      </div>
    </div>
  );
}

function ParamRow({
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
      <span className="w-16 text-muted-foreground">{label}</span>
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


export function SidebarRight() {
  const { rightPanelTab, setRightPanelTab } = useUIStore();

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex flex-wrap border-b border-panel-border">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setRightPanelTab(tab.id)}
              className={cn(
                "flex flex-1 basis-[4.5rem] items-center justify-center gap-1.5 border-b-2 px-2 py-2 text-xs transition-colors",
                rightPanelTab === tab.id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          );
        })}
      </div>
      <div className="flex-1 overflow-hidden">
        {/* AI 面板保持挂载：切换 tab 不丢失生成状态（接受/拒绝面板、诊断结果等） */}
        <div className={cn("h-full", rightPanelTab !== "ai" && "hidden")}>
          <AIPanel />
        </div>
        {rightPanelTab === "material" && <MaterialPanel />}
        {rightPanelTab === "template" && <SceneTemplatePanel />}
        {rightPanelTab === "character" && <CharacterPanel />}
        {rightPanelTab === "scene" && <ScenePanel />}
        {rightPanelTab === "anchor" && <AnchorPanel />}
        {rightPanelTab === "styleProfile" && <StyleProfilePanel />}
        {rightPanelTab === "settings" && <SettingsPanel />}
      </div>
    </div>
  );
}
