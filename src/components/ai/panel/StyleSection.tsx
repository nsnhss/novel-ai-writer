// 风格区：5 维感官权重 + 5 轴氛围调色板滑杆（状态全部就近取自 generationStore）
import { useGenerationStore, DEFAULT_SENSORY_WEIGHTS, DEFAULT_ATMOSPHERE } from "@/stores/generationStore";
import { SliderRow } from "@/components/ui/slider-row";

/** 氛围轴：左端词 / 右端词 / 参数键 */
const ATMOSPHERE_AXES = [
  { key: "gentleRough", left: "轻柔", right: "粗暴" },
  { key: "implicitExplicit", left: "含蓄", right: "直白" },
  { key: "romanticPrimitive", left: "浪漫", right: "原始" },
  { key: "mentalAction", left: "心理", right: "动作" },
  { key: "slowFast", left: "慢", right: "快" },
] as const;

const SENSORY_ITEMS = [
  { key: "visual", label: "视觉" },
  { key: "tactile", label: "触觉" },
  { key: "auditory", label: "听觉" },
  { key: "olfactory", label: "嗅觉" },
  { key: "mental", label: "心理感受" },
] as const;

/** 氛围值显示：带符号，便于区分偏向 */
const formatAxis = (v: number) => (v > 0 ? `+${v}` : String(v));

export function StyleSection() {
  const { params, setParams, saveParams } = useGenerationStore();

  return (
    <div className="space-y-4">
      {/* 感官权重 */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs font-medium text-muted-foreground">感官权重</div>
          <button
            onClick={() => {
              setParams({ sensoryWeights: { ...DEFAULT_SENSORY_WEIGHTS } });
              saveParams();
            }}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            重置平均
          </button>
        </div>
        <div className="space-y-2">
          {SENSORY_ITEMS.map(({ key, label }) => (
            <SliderRow
              key={key}
              label={label}
              min={0}
              max={100}
              step={1}
              value={params.sensoryWeights[key]}
              defaultValue={DEFAULT_SENSORY_WEIGHTS[key]}
              onChange={(value) => {
                setParams({ sensoryWeights: { ...params.sensoryWeights, [key]: value } });
                saveParams();
              }}
            />
          ))}
        </div>
      </div>

      {/* 氛围调色板 */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs font-medium text-muted-foreground">氛围调色板</div>
          <button
            onClick={() => {
              setParams({ atmosphere: { ...DEFAULT_ATMOSPHERE } });
              saveParams();
            }}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            重置中性
          </button>
        </div>
        <div className="space-y-2">
          {ATMOSPHERE_AXES.map(({ key, left, right }) => (
            <SliderRow
              key={key}
              label={`${left} ↔ ${right}`}
              min={-50}
              max={50}
              step={1}
              value={params.atmosphere[key]}
              defaultValue={DEFAULT_ATMOSPHERE[key]}
              formatValue={formatAxis}
              onChange={(value) => {
                setParams({ atmosphere: { ...params.atmosphere, [key]: value } });
                saveParams();
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
