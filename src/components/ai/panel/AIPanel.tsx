// AI 面板容器：主操作区常驻顶部，下方「生成 / 历史」分段切换，底部固定模型/摘要/token 统计
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  GitBranch,
  RefreshCw,
  Send,
  Sparkles,
  Square,
  Star,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/stores/uiStore";
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
import { loadLastRating, saveLastRating } from "@/lib/rating";
import { toast } from "@/lib/toast";
import { OutlineDialog } from "@/components/ai/OutlineDialog";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ContextSection } from "./ContextSection";
import { ParamsSection } from "./ParamsSection";
import { StyleSection } from "./StyleSection";
import { HistorySection } from "./HistorySection";

export function AIPanel() {
  const { currentBookId, currentChapterId, currentDocNode, volumes, loadBookTree } = useBookStore();
  const { previewContext } = useContextStore();
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
    consumePendingRagQuery,
    reset,
  } = useGenerationStore();
  const { tags, loadTags, loadMaterials } = useMaterialStore();
  const { loadHistory } = useGenerationHistoryStore();
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
  // 评分与 GenerationToolbar/改写对话框共用同一份记忆
  const [rating, setRatingState] = useState(loadLastRating);
  const setRating = (star: number) => {
    setRatingState(star);
    saveLastRating(star);
  };
  const [contentLevel, setContentLevel] = useState("general");
  const [selectedContentLevels, setSelectedContentLevels] = useState<string[]>(["general"]);
  const [diagnosticDimensions, setDiagnosticDimensions] = useState<{ key: string; name: string }[]>([]);
  const [diagnosticResults, setDiagnosticResults] = useState<{ key: string; name: string; suggestion: string }[] | null>(null);
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [selectedDiagnosticKeys, setSelectedDiagnosticKeys] = useState<string[]>([]);
  const [consistencyWarnings, setConsistencyWarnings] = useState<{ warningType: string; description: string; quote: string }[] | null>(null);
  const [isCheckingConsistency, setIsCheckingConsistency] = useState(false);

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
          setRatingState(loadLastRating());
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
      setRatingState(loadLastRating());
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
      setRatingState(loadLastRating());
      setContentLevel("general");
    }
  };

  const handleReject = async () => {
    // 拒绝会移除已生成文本且不可恢复，二次确认防误点
    const ok = await confirmDialog({
      title: "拒绝此次生成？",
      description: "已生成内容将被移除，此操作不可恢复。",
      confirmText: "拒绝",
      danger: true,
    });
    if (!ok) return;
    try {
      await rejectGeneration(rating);
    } finally {
      setShowActions(false);
      setRatingState(loadLastRating());
      setContentLevel("general");
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto p-3">
        {/* 主操作区：常驻顶部 */}
        <div className="mb-3 space-y-2">
          {genError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              <p className="mb-1 font-medium">生成失败</p>
              <p className="max-h-32 overflow-auto whitespace-pre-wrap">{genError}</p>
              <p className="mt-2 text-destructive/80">请检查：模型是否已选择、API Key 是否已配置、网络是否畅通</p>
            </div>
          )}

          {isGenerating ? (
            <Button variant="secondary" className="h-10 w-full text-base" onClick={abortGeneration}>
              <Square size={16} /> 中断
            </Button>
          ) : (
            <Button
              className="h-10 w-full text-base"
              onClick={handleContinue}
              disabled={!currentBookId || !currentChapterId || !currentModel}
            >
              <Send size={16} /> 续写
            </Button>
          )}

          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={handleBranchContinue}
              disabled={!currentBookId || !currentChapterId || !currentModel}
            >
              <GitBranch size={14} /> 多分支续写
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setShowOutlineDialog(true)}
              disabled={!currentBookId || !currentChapterId || !currentModel}
            >
              生成大纲
            </Button>
          </div>

          {/* currentLogId 由 generationStore 维护：在编辑器工具条接受/拒绝后会重置为 null，此处同步隐藏 */}
          {showActions && !isGenerating && currentLogId && (
            <div className="space-y-2 rounded-md border border-border p-2">
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
                <Button className="flex-1" onClick={handleAccept}>
                  <Check size={14} /> 接受并入库
                </Button>
                <Button variant="destructive" className="flex-1" onClick={handleReject}>
                  <X size={14} /> 拒绝
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* 生成 / 历史 分段切换 */}
        <Tabs defaultValue="generate">
          <TabsList variant="pills" className="mb-3 w-full">
            <TabsTrigger value="generate" className="flex-1">
              生成
            </TabsTrigger>
            <TabsTrigger value="history" className="flex-1">
              历史
            </TabsTrigger>
          </TabsList>

          <TabsContent value="generate" className="space-y-3">
            <div className="rounded-lg bg-muted p-3 text-sm">
              <p className="text-muted-foreground">
                AI 助手已就绪。点击"续写"从光标处流式生成，或先预览上下文与 Token 预算。
              </p>
            </div>

            {/* 上下文区：默认展开 */}
            <ContextSection
              ragQuery={ragQuery}
              onRagQueryChange={setRagQuery}
              onPreview={handlePreviewContext}
              disabled={!currentBookId || !currentChapterId}
            />

            {/* 参数区：手风琴，默认收起 */}
            <AccordionSection id="params" title="生成参数">
              <ParamsSection
                contentLevelOptions={contentLevelOptions}
                selectedContentLevels={selectedContentLevels}
                onToggleContentLevel={toggleContentLevel}
                onSetContentLevels={setSelectedContentLevels}
                adultMode={adultMode}
                templates={visibleTemplates}
                selectedTemplateId={selectedTemplateId}
                onSelectTemplate={setSelectedTemplateId}
                isGeneratingBeats={isGeneratingBeats}
                onGenerateBeats={handleGenerateBeats}
                canGenerate={Boolean(currentBookId && currentChapterId)}
              />
            </AccordionSection>

            {/* 风格区：手风琴，默认收起 */}
            <AccordionSection id="style" title="风格参数">
              <StyleSection />
            </AccordionSection>

            {/* 一致性警告 / 诊断：原逻辑保留 */}
            {isCheckingConsistency && (
              <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-2 text-xs text-yellow-600">
                <span className="flex items-center gap-1">
                  <RefreshCw size={12} className="animate-spin" /> 正在检查设定一致性...
                </span>
              </div>
            )}

            {consistencyWarnings && consistencyWarnings.length > 0 && (
              <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-2 text-xs">
                <div className="mb-2 flex items-center justify-between font-medium text-yellow-600">
                  <span className="flex items-center gap-1">
                    <AlertTriangle size={12} /> 发现 {consistencyWarnings.length} 处不一致
                  </span>
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
                        <div className="font-medium">
                          {typeLabel[w.warningType] ?? w.warningType}：{w.description}
                        </div>
                        {w.quote && <div className="mt-0.5 text-muted-foreground">“{w.quote}”</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {adultMode && diagnosticDimensions.length > 0 && (
              <div className="rounded-md border border-border p-2 text-xs">
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
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex-1"
                    onClick={() => handleDiagnose(generatedText)}
                    disabled={isDiagnosing || !generatedText.trim()}
                  >
                    {isDiagnosing ? "诊断中..." : "诊断生成内容"}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex-1"
                    onClick={() => handleDiagnose(currentDocNode?.content ?? "")}
                    disabled={isDiagnosing || !currentDocNode?.content?.trim()}
                  >
                    诊断当前段落
                  </Button>
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
          </TabsContent>

          <TabsContent value="history">
            <HistorySection />
          </TabsContent>
        </Tabs>
      </div>

      {/* 底部固定区：模型切换 / 摘要按钮组 / token 统计 */}
      <div className="space-y-2 border-t border-panel-border p-3">
        <div className="flex items-center gap-2">
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
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {currentModel ? currentModel.modelName : "—"}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleSummarizeChapter}
            disabled={isSummarizing || !currentChapterId || !currentModel}
          >
            <Sparkles size={12} /> 章摘要
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleSummarizeVolume}
            disabled={isSummarizing || !currentVolume?.id || !currentModel}
          >
            <Sparkles size={12} /> 卷摘要
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleSummarizeBook}
            disabled={isSummarizing || !currentBookId || !currentModel}
          >
            <Sparkles size={12} /> 全书摘要
          </Button>
        </div>

        {(inputTokens > 0 || outputTokens > 0) && (
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>输入 tokens: {inputTokens}</span>
            <span>输出 tokens: {outputTokens}</span>
          </div>
        )}
      </div>

      <OutlineDialog open={showOutlineDialog} onClose={() => setShowOutlineDialog(false)} />
    </div>
  );
}

/** 手风琴分区：标题行 + ChevronDown 旋转，展开状态存 uiStore（默认收起） */
function AccordionSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const expanded = useUIStore((s) => s.aiPanelSections[id] ?? false);
  const toggle = useUIStore((s) => s.toggleAiPanelSection);

  return (
    <div className="rounded-md border border-border">
      <button
        onClick={() => toggle(id)}
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <span>{title}</span>
        <ChevronDown size={14} className={cn("transition-transform", expanded && "rotate-180")} />
      </button>
      {expanded && <div className="border-t border-border p-3">{children}</div>}
    </div>
  );
}
