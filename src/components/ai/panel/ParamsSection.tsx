// 参数区：内容级别、场景模板与 6 个生成参数滑杆
import { useGenerationStore } from "@/stores/generationStore";
import type { SceneTemplate } from "@/stores/sceneTemplateStore";
import { Button } from "@/components/ui/button";
import { SliderRow } from "@/components/ui/slider-row";

export interface ParamsSectionProps {
  /** 内容级别选项（general + 素材库 content_level 标签） */
  contentLevelOptions: string[];
  selectedContentLevels: string[];
  onToggleContentLevel: (level: string) => void;
  /** 成人级别素材批量勾选/取消（直接替换选中集合） */
  onSetContentLevels: (updater: (prev: string[]) => string[]) => void;
  adultMode: boolean;
  /** 按成人模式过滤后的可见场景模板 */
  templates: SceneTemplate[];
  selectedTemplateId: string;
  onSelectTemplate: (id: string) => void;
  isGeneratingBeats: boolean;
  onGenerateBeats: () => void;
  /** 是否已选中书籍与章节（控制按节拍生成按钮可用性） */
  canGenerate: boolean;
}

export function ParamsSection({
  contentLevelOptions,
  selectedContentLevels,
  onToggleContentLevel,
  onSetContentLevels,
  adultMode,
  templates,
  selectedTemplateId,
  onSelectTemplate,
  isGeneratingBeats,
  onGenerateBeats,
  canGenerate,
}: ParamsSectionProps) {
  const { params, setParams, saveParams } = useGenerationStore();

  const adultLevels = contentLevelOptions.filter((l) => l !== "general" && l !== "inspiration");

  return (
    <div className="space-y-3">
      {/* 内容级别勾选 */}
      <div className="flex flex-wrap gap-2">
        {contentLevelOptions.map((level) => (
          <label
            key={level}
            className="flex cursor-pointer items-center gap-1 rounded bg-muted px-2 py-1 text-xs"
          >
            <input
              type="checkbox"
              checked={selectedContentLevels.includes(level)}
              onChange={() => onToggleContentLevel(level)}
              className="h-3 w-3"
            />
            {level}
          </label>
        ))}
      </div>

      {adultMode && adultLevels.length > 0 && (
        <label className="flex cursor-pointer items-center gap-2 rounded bg-muted/50 px-2 py-1 text-xs">
          <input
            type="checkbox"
            checked={adultLevels.every((l) => selectedContentLevels.includes(l))}
            onChange={() => {
              const allSelected = adultLevels.every((l) => selectedContentLevels.includes(l));
              if (allSelected) {
                onSetContentLevels((prev) => prev.filter((l) => !adultLevels.includes(l)));
              } else {
                onSetContentLevels((prev) => Array.from(new Set([...prev, ...adultLevels])));
              }
            }}
            className="h-3 w-3"
          />
          包含成人级别素材
        </label>
      )}

      {/* 场景模板 */}
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">场景模板</label>
        <select
          value={selectedTemplateId}
          onChange={(e) => onSelectTemplate(e.target.value)}
          className="w-full rounded-md bg-muted px-2 py-1.5 text-xs outline-none"
        >
          <option value="">无</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        {selectedTemplateId && (() => {
          const t = templates.find((x) => x.id === selectedTemplateId);
          const beatCount = t?.beats ? (() => { try { return (JSON.parse(t.beats) as unknown[]).length; } catch { return 0; } })() : 0;
          return beatCount > 0 ? (
            <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>包含 {beatCount} 个节拍</span>
              <Button
                size="sm"
                onClick={onGenerateBeats}
                disabled={isGeneratingBeats || !canGenerate}
              >
                {isGeneratingBeats ? "生成中..." : "按节拍生成"}
              </Button>
            </div>
          ) : null;
        })()}
      </div>

      {/* 生成参数滑杆 */}
      <div className="space-y-2">
        <SliderRow
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
        <SliderRow
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
        <SliderRow
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
        <SliderRow
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
        <SliderRow
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
        <SliderRow
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
  );
}
