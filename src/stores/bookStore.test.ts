import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { useBookStore, type Book, type Volume, type DocNode } from "./bookStore";

const mockInvoke = vi.mocked(invoke);

const book1: Book = {
  id: "b1",
  title: "书一",
  author: "",
  description: "",
  wordCount: 0,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};

const book2: Book = { ...book1, id: "b2", title: "书二" };

const tree: Volume[] = [
  {
    id: "v1",
    bookId: "b1",
    title: "第 1 卷",
    number: 1,
    summary: "",
    createdAt: "2026-01-01",
    chapters: [
      {
        id: "c1",
        volumeId: "v1",
        title: "第 1 章",
        number: 1,
        summary: "",
        status: "draft",
        wordCount: 100,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      },
      {
        id: "c2",
        volumeId: "v1",
        title: "第 2 章",
        number: 2,
        summary: "",
        status: "draft",
        wordCount: 200,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      },
    ],
  },
];

const docNode: DocNode = {
  id: "d1",
  chapterId: "c1",
  content: "正文内容",
  plainText: "正文内容",
  wordCount: 4,
  version: 1,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};

/** 按命令名路由的 invoke mock */
function routeInvoke(routes: Record<string, unknown | ((args: unknown) => unknown)>) {
  mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
    const entry = routes[cmd];
    if (entry === undefined) {
      throw new Error(`未 mock 的命令: ${cmd}`);
    }
    return typeof entry === "function" ? (entry as (a: unknown) => unknown)(args) : entry;
  });
}

function resetStore() {
  localStorage.clear();
  useBookStore.setState({
    books: [],
    currentBookId: null,
    currentChapterId: null,
    volumes: [],
    currentDocNode: null,
    isLoading: false,
    error: null,
  });
}

describe("bookStore", () => {
  beforeEach(() => {
    resetStore();
    mockInvoke.mockReset();
  });

  it("loadBooks: 加载书籍后选中上次的书并加载目录与章节", async () => {
    localStorage.setItem("novelWriter:lastBookId", "b2");
    localStorage.setItem("novelWriter:lastChapterId", "c1");
    routeInvoke({
      list_books: [book1, book2],
      get_book_tree: tree,
      get_chapter_content: docNode,
      get_adult_mode: false,
    });

    await useBookStore.getState().loadBooks();
    const s = useBookStore.getState();
    expect(s.books).toHaveLength(2);
    expect(s.currentBookId).toBe("b2");
    expect(s.volumes).toHaveLength(1);
    expect(s.currentChapterId).toBe("c1");
    expect(s.currentDocNode?.content).toBe("正文内容");
    expect(s.error).toBeNull();
  });

  it("loadBooks: 没有书时自动创建「未命名作品」", async () => {
    const created: Book = { ...book1, id: "new", title: "未命名作品" };
    let listCalls = 0;
    routeInvoke({
      // 第一次返回空列表触发自动创建，创建后返回新书
      list_books: () => (++listCalls === 1 ? [] : [created]),
      create_book: created,
      get_book_tree: [],
    });

    await useBookStore.getState().loadBooks();
    expect(mockInvoke).toHaveBeenCalledWith("create_book", {
      req: { title: "未命名作品", author: "", description: "" },
    });
    expect(useBookStore.getState().currentBookId).toBe("new");
  });

  it("loadBooks: IPC 失败时写入 error", async () => {
    mockInvoke.mockRejectedValue(new Error("db locked"));
    await useBookStore.getState().loadBooks();
    const s = useBookStore.getState();
    expect(s.error).toContain("加载作品列表失败");
    expect(s.isLoading).toBe(false);
  });

  it("createBook: 创建后设为当前书并刷新列表", async () => {
    routeInvoke({
      create_book: book1,
      get_book_tree: tree,
      get_chapter_content: docNode,
      get_adult_mode: false,
      list_books: [book1],
    });

    const book = await useBookStore.getState().createBook("书一");
    expect(book.id).toBe("b1");
    const s = useBookStore.getState();
    expect(s.currentBookId).toBe("b1");
    expect(s.books).toHaveLength(1);
    expect(s.currentChapterId).toBe("c1"); // 自动打开第一章
  });

  it("loadChapter: 记录 lastChapterId 到 localStorage", async () => {
    routeInvoke({
      get_chapter_content: docNode,
      get_adult_mode: false,
    });

    await useBookStore.getState().loadChapter("c1");
    expect(useBookStore.getState().currentChapterId).toBe("c1");
    expect(localStorage.getItem("novelWriter:lastChapterId")).toBe("c1");
  });

  it("saveChapter: 更新 currentDocNode 并同步目录中的字数", async () => {
    useBookStore.setState({ volumes: tree, currentBookId: "b1" });
    const saved: DocNode = { ...docNode, wordCount: 500, updatedAt: "2026-01-02" };
    routeInvoke({
      update_chapter: saved,
      auto_summarize_chapter: null,
    });

    await useBookStore.getState().saveChapter("c1", undefined, "新内容");
    const s = useBookStore.getState();
    expect(s.currentDocNode?.wordCount).toBe(500);
    expect(s.volumes[0].chapters?.[0].wordCount).toBe(500);
    expect(s.volumes[0].chapters?.[1].wordCount).toBe(200); // 其他章节不受影响
    // 后台自动摘要被触发（best-effort）
    expect(mockInvoke).toHaveBeenCalledWith("auto_summarize_chapter", { chapterId: "c1" });
  });

  it("deleteBook: 删除当前书后切换到下一本", async () => {
    useBookStore.setState({ books: [book1, book2], currentBookId: "b1" });
    routeInvoke({
      delete_book: null,
      get_book_tree: [],
    });

    await useBookStore.getState().deleteBook("b1");
    const s = useBookStore.getState();
    expect(s.books.map((b) => b.id)).toEqual(["b2"]);
    expect(mockInvoke).toHaveBeenCalledWith("get_book_tree", { bookId: "b2" });
  });

  it("deleteBook: 删除最后一本后清空状态", async () => {
    useBookStore.setState({ books: [book1], currentBookId: "b1" });
    routeInvoke({ delete_book: null });

    await useBookStore.getState().deleteBook("b1");
    const s = useBookStore.getState();
    expect(s.books).toHaveLength(0);
    expect(s.currentBookId).toBeNull();
    expect(s.volumes).toHaveLength(0);
    expect(s.currentDocNode).toBeNull();
  });
});
