// 历史区：生成历史列表（按多分支分组折叠，删除需确认）
import { useState } from "react";
import { ChevronRight, Copy, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGenerationHistoryStore, type GenerationHistoryItem } from "@/stores/generationHistoryStore";
import { getEditorRef } from "@/lib/editorRef";
import { confirmDialog } from "@/components/ui/confirm-dialog";

export function HistorySection() {
  const { history } = useGenerationHistoryStore();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  if (history.length === 0) {
    return <p className="py-6 text-center text-xs text-muted-foreground">暂无生成历史</p>;
  }

  // 按 groupId 分组（多分支续写同组），组间按最新时间倒序
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

  return (
    <div className="rounded-lg border border-border">
      <div className="border-b border-border px-3 py-2 text-xs font-medium">生成历史</div>
      <div className="max-h-96 space-y-2 overflow-y-auto p-2">
        {flat.map(([groupId, items]) => {
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
                  {accepted && (
                    <span className="ml-1 text-green-500">
                      (已采用 {String.fromCharCode(65 + accepted.branchIndex)})
                    </span>
                  )}
                </span>
                <ChevronRight
                  size={12}
                  className={cn("text-muted-foreground transition-transform", isExpanded && "rotate-90")}
                />
              </button>
              {isExpanded && (
                <div className="mt-2 space-y-2 border-t border-border pt-2">
                  {items.map((h) => (
                    <HistoryItemCard key={h.id} item={h} branchLabel={String.fromCharCode(65 + h.branchIndex)} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HistoryItemCard({ item, branchLabel }: { item: GenerationHistoryItem; branchLabel?: string }) {
  const { deleteHistory } = useGenerationHistoryStore();

  const handleDelete = async () => {
    const ok = await confirmDialog({
      title: "删除生成记录",
      description: "确定删除这条生成记录？此操作不可撤销。",
      confirmText: "删除",
      danger: true,
    });
    if (ok) deleteHistory(item.id);
  };

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
      <p className="mb-2 line-clamp-3 whitespace-pre-wrap text-foreground/90">{item.content}</p>
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
          onClick={handleDelete}
          className="rounded p-1 text-muted-foreground hover:bg-background"
          title="删除记录"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}
