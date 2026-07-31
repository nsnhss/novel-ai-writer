// 参数滑杆行：标签 + 当前值 + range 滑杆，支持双击标签重置默认值
import { cn } from "@/lib/utils";

export interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  /** 提供后双击标签可重置为该值 */
  defaultValue?: number;
  /** 自定义当前值的显示格式 */
  formatValue?: (v: number) => string;
  className?: string;
}

export function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  defaultValue,
  formatValue,
  className,
}: SliderRowProps) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-center justify-between">
        <span
          className={cn("text-sm", defaultValue !== undefined && "cursor-default select-none")}
          title={defaultValue !== undefined ? "双击重置为默认值" : undefined}
          onDoubleClick={defaultValue !== undefined ? () => onChange(defaultValue) : undefined}
        >
          {label}
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {formatValue ? formatValue(value) : value}
        </span>
      </div>
      <input
        type="range"
        className="w-full"
        style={{ accentColor: "var(--accent)" }}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
