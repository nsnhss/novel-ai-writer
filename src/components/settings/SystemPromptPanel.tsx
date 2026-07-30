import { useEffect, useState } from "react";
import { Save, RotateCcw } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

const DEFAULT_TEMPLATE =
  "你是一位专业中文网络小说写作助手。请根据提供的作品设定、前文上下文、参考素材和当前光标位置，续写后续内容。要求：保持人物设定一致、语言风格统一、情节连贯、节奏紧凑。{forbidden_topics}";

export function SystemPromptPanel() {
  const [template, setTemplate] = useState("");
  const [forbiddenTopics, setForbiddenTopics] = useState("");
  const [saved, setSaved] = useState(false);
  const [recommendations, setRecommendations] = useState<{ dimension: string; finding: string; suggestedAction: string }[] | null>(null);
  const [selectedRecommendations, setSelectedRecommendations] = useState<Set<number>>(new Set());
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [tuningError, setTuningError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const storedTemplate = await invoke<string>("get_system_prompt_template");
      const storedTopics = await invoke<string>("get_forbidden_topics");
      setTemplate(storedTemplate || DEFAULT_TEMPLATE);
      setForbiddenTopics(storedTopics);
    };
    load();
  }, []);

  const handleSave = async () => {
    await invoke("set_system_prompt_template", { template: template.trim() });
    await invoke("set_forbidden_topics", { topics: forbiddenTopics.trim() });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const handleReset = () => {
    setTemplate(DEFAULT_TEMPLATE);
    setForbiddenTopics("");
  };

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    setTuningError(null);
    try {
      const result = await invoke<{ dimension: string; finding: string; suggestedAction: string }[]>("recommend_system_prompt_tuning");
      setRecommendations(result);
      setSelectedRecommendations(new Set(result.map((_, i) => i)));
    } catch (err) {
      setTuningError(String(err));
    } finally {
      setIsAnalyzing(false);
    }
  };

  const toggleRecommendation = (idx: number) => {
    setSelectedRecommendations((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleApplyTuning = async () => {
    if (!recommendations) return;
    const actions = Array.from(selectedRecommendations)
      .sort((a, b) => a - b)
      .map((i) => recommendations[i].suggestedAction);
    try {
      await invoke("apply_system_prompt_tuning", { recommendations: actions });
      const storedTemplate = await invoke<string>("get_system_prompt_template");
      setTemplate(storedTemplate || DEFAULT_TEMPLATE);
      setSelectedRecommendations(new Set());
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setTuningError(String(err));
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          System Prompt 模板
        </label>
        <textarea
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          rows={8}
          className="w-full rounded-md border border-panel-border bg-muted px-3 py-2 text-xs outline-none"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          使用 {"{forbidden_topics}"} 占位符控制禁区列表插入位置。
        </p>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">禁区列表</label>
        <textarea
          value={forbiddenTopics}
          onChange={(e) => setForbiddenTopics(e.target.value)}
          rows={4}
          placeholder="每行一个禁区主题，生成时将通过 {forbidden_topics} 注入 System Prompt"
          className="w-full rounded-md border border-panel-border bg-muted px-3 py-2 text-xs outline-none"
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90"
        >
          <Save size={12} /> 保存
        </button>
        <button
          onClick={handleReset}
          className="flex items-center gap-1 rounded-md bg-muted px-3 py-1.5 text-xs hover:bg-muted/80"
        >
          <RotateCcw size={12} /> 恢复默认
        </button>
        {saved && <span className="text-xs text-green-500">已保存</span>}
      </div>

      <div className="rounded-md border border-panel-border p-3 text-xs">
        <div className="mb-2 flex items-center justify-between font-medium text-muted-foreground">
          <span>自动优化建议</span>
          <button
            onClick={handleAnalyze}
            disabled={isAnalyzing}
            className="rounded-md bg-muted px-2 py-1 hover:bg-muted/80 disabled:opacity-50"
          >
            {isAnalyzing ? "分析中..." : "分析近期评分"}
          </button>
        </div>
        {tuningError && <div className="mb-2 text-red-500">{tuningError}</div>}
        {recommendations === null ? (
          <div className="text-muted-foreground">点击上方按钮，基于近期高分/低分生成内容给出 System Prompt 调优建议。</div>
        ) : recommendations.length === 0 ? (
          <div className="text-muted-foreground">近期数据不足或风格稳定，暂无建议。</div>
        ) : (
          <>
            <div className="mb-2 space-y-1">
              {recommendations.map((rec, idx) => (
                <label key={idx} className="flex cursor-pointer items-start gap-2 rounded bg-muted/50 p-2">
                  <input
                    type="checkbox"
                    checked={selectedRecommendations.has(idx)}
                    onChange={() => toggleRecommendation(idx)}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="font-medium">{rec.dimension}</div>
                    <div className="text-muted-foreground">{rec.finding}</div>
                    <div className="mt-0.5 text-primary">{rec.suggestedAction}</div>
                  </div>
                </label>
              ))}
            </div>
            <button
              onClick={handleApplyTuning}
              disabled={selectedRecommendations.size === 0}
              className="w-full rounded-md bg-primary py-1.5 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              应用 {selectedRecommendations.size} 条建议到 System Prompt
            </button>
          </>
        )}
      </div>
    </div>
  );
}
