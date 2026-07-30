import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class {},
}));

import { invoke } from "@tauri-apps/api/core";
import { useGenerationStore } from "./generationStore";
import { useBookStore } from "./bookStore";
import { setEditorRef } from "@/lib/editorRef";

const mockInvoke = vi.mocked(invoke);

function makeEditorMock() {
  return {
    commitGeneration: vi.fn(),
    rollbackGeneration: vi.fn(),
    startGeneration: vi.fn(() => 0),
  };
}

function resetStores() {
  localStorage.clear();
  useGenerationStore.getState().reset();
  useGenerationStore.setState({ lastContinueRequest: null });
  useBookStore.setState({ currentBookId: "b1", currentChapterId: "c1" });
}

describe("generationStore 接受/拒绝流", () => {
  beforeEach(() => {
    resetStores();
    mockInvoke.mockReset();
    setEditorRef(null);
  });

  it("acceptGeneration: 提交反馈、提交编辑器、写入历史并重置状态", async () => {
    const editor = makeEditorMock();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setEditorRef(editor as any);
    useGenerationStore.setState({ currentLogId: "log1", generatedText: "生成的文本" });
    mockInvoke.mockResolvedValue(null);

    await useGenerationStore.getState().acceptGeneration({ rating: 5 });

    // 反馈入库（accepted: true）
    expect(mockInvoke).toHaveBeenCalledWith("submit_generation_feedback", {
      req: expect.objectContaining({
        logId: "log1",
        rating: 5,
        accepted: true,
        content: "生成的文本",
      }),
    });
    // 生成内容被提交到编辑器
    expect(editor.commitGeneration).toHaveBeenCalled();
    expect(editor.rollbackGeneration).not.toHaveBeenCalled();
    // 历史记录（accepted: true, rating: 5）
    expect(mockInvoke).toHaveBeenCalledWith("save_generation_history", {
      req: expect.objectContaining({ chapterId: "c1", accepted: true, rating: 5 }),
    });
    // 状态已重置
    const s = useGenerationStore.getState();
    expect(s.currentLogId).toBeNull();
    expect(s.generatedText).toBe("");
  });

  it("acceptGeneration: 无编辑器或无 logId 时为空操作", async () => {
    setEditorRef(null);
    useGenerationStore.setState({ currentLogId: null, generatedText: "x" });

    await useGenerationStore.getState().acceptGeneration({ rating: 4 });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("rejectGeneration: 回滚编辑器、记录拒绝并重置状态", async () => {
    const editor = makeEditorMock();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setEditorRef(editor as any);
    useGenerationStore.setState({ currentLogId: "log2", generatedText: "不想要的文本" });
    mockInvoke.mockResolvedValue(null);

    await useGenerationStore.getState().rejectGeneration(2);

    expect(editor.rollbackGeneration).toHaveBeenCalled();
    expect(editor.commitGeneration).not.toHaveBeenCalled();
    expect(mockInvoke).toHaveBeenCalledWith("reject_generation", { id: "log2", rating: 2 });
    expect(mockInvoke).toHaveBeenCalledWith("save_generation_history", {
      req: expect.objectContaining({ chapterId: "c1", accepted: false, rating: 2 }),
    });
    const s = useGenerationStore.getState();
    expect(s.currentLogId).toBeNull();
    expect(s.generatedText).toBe("");
  });

  it("rejectGeneration: 后端调用失败也会重置状态（finally）", async () => {
    const editor = makeEditorMock();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setEditorRef(editor as any);
    useGenerationStore.setState({ currentLogId: "log3", generatedText: "x" });
    mockInvoke.mockRejectedValue(new Error("db error"));

    await useGenerationStore.getState().rejectGeneration(1);
    expect(useGenerationStore.getState().currentLogId).toBeNull();
  });
});
