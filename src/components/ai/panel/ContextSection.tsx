// 上下文区：RAG 关键词输入、预览上下文与 Token 预算、上下文明细
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useContextStore } from "@/stores/contextStore";
import { Button } from "@/components/ui/button";

const TOTAL_BUDGET = 6000;

export interface ContextSectionProps {
  /** RAG 检索关键词（受控于 AIPanel 容器，续写/多分支共用） */
  ragQuery: string;
  onRagQueryChange: (value: string) => void;
  onPreview: () => void;
  /** 未选中书籍/章节时禁用预览 */
  disabled: boolean;
}

export function ContextSection({ ragQuery, onRagQueryChange, onPreview, disabled }: ContextSectionProps) {
  const { currentContext, isLoading, error } = useContextStore();

  const usedTokens = currentContext?.tokenCounts.total ?? 0;
  const usagePercent = Math.min((usedTokens / TOTAL_BUDGET) * 100, 100);

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={ragQuery}
        onChange={(e) => onRagQueryChange(e.target.value)}
        placeholder="RAG 检索关键词（留空使用光标前 200 字）"
        className="w-full rounded-md bg-muted px-3 py-2 text-sm outline-none ring-ring focus:ring-1"
      />
      <Button variant="secondary" className="w-full" onClick={onPreview} disabled={isLoading || disabled}>
        {isLoading ? "组装中…" : "预览上下文与 Token 预算"}
      </Button>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      {currentContext && (
        <div className="space-y-3 text-sm">
          <div>
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>Token 预算</span>
              <span>
                {usedTokens} / {TOTAL_BUDGET}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  usagePercent > 90 ? "bg-destructive" : usagePercent > 70 ? "bg-yellow-500" : "bg-green-500"
                )}
                style={{ width: `${usagePercent}%` }}
              />
            </div>
          </div>

          <div className="rounded-lg border border-border">
            <div className="border-b border-border px-3 py-2 text-xs font-medium">分区明细</div>
            <div className="divide-y divide-border text-xs">
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
            <div className="rounded-lg border border-border">
              <div className="border-b border-border px-3 py-2 text-xs font-medium">
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
