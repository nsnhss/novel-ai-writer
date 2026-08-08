import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { getEditorRef } from "@/lib/editorRef";

/** 清理章节光标缓存（MarkdownEditor 每章一条 localStorage 记录，删除章节/书时需同步清理避免累积） */
function clearCursorCache(chapterIds: string[]) {
  for (const id of chapterIds) {
    localStorage.removeItem(`novelWriter:lastCursor:${id}`);
  }
}

export interface Book {
  id: string;
  title: string;
  author: string;
  description: string;
  coverPath?: string;
  wordCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Volume {
  id: string;
  bookId: string;
  title: string;
  number: number;
  summary: string;
  createdAt: string;
  chapters?: Chapter[];
}

export interface Chapter {
  id: string;
  volumeId: string;
  title: string;
  number: number;
  summary: string;
  status: string;
  wordCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DocNode {
  id: string;
  chapterId: string;
  content: string;
  plainText: string;
  wordCount: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface BookState {
  books: Book[];
  currentBookId: string | null;
  currentChapterId: string | null;
  volumes: Volume[];
  currentDocNode: DocNode | null;
  isLoading: boolean;
  error: string | null;
  loadBooks: () => Promise<void>;
  createBook: (title: string, author?: string, description?: string) => Promise<Book>;
  createVolume: (bookId: string, title: string) => Promise<Volume>;
  createChapter: (volumeId: string, title: string) => Promise<Chapter>;
  deleteVolume: (volumeId: string) => Promise<void>;
  deleteChapter: (chapterId: string) => Promise<void>;
  renameChapter: (chapterId: string, title: string) => Promise<void>;
  renameVolume: (volumeId: string, title: string) => Promise<void>;
  renameBook: (bookId: string, title: string) => Promise<void>;
  moveVolume: (bookId: string, volumeId: string, direction: "up" | "down") => Promise<void>;
  moveChapter: (volumeId: string, chapterId: string, direction: "up" | "down") => Promise<void>;
  loadBookTree: (bookId: string) => Promise<void>;
  loadChapter: (chapterId: string) => Promise<void>;
  saveChapter: (chapterId: string, title?: string, contentMarkdown?: string, plainText?: string) => Promise<void>;
  deleteBook: (bookId: string) => Promise<void>;
  exportBook: (bookId: string, format: "md" | "txt") => Promise<{ content: string; fileName: string }>;
  clearError: () => void;
}

export const useBookStore = create<BookState>((set, get) => ({
  books: [],
  currentBookId: null,
  currentChapterId: null,
  volumes: [],
  currentDocNode: null,
  isLoading: false,
  error: null,

  clearError: () => set({ error: null }),

  exportBook: async (bookId, format) => {
    return invoke<{ content: string; fileName: string }>("export_book", { bookId, format });
  },

  deleteBook: async (bookId) => {
    set({ error: null });
    try {
      // 删除前收集该书所有章节 id，用于清理 localStorage 光标缓存
      let chapterIds: string[] = [];
      try {
        const volumes = await invoke<Volume[]>("get_book_tree", { bookId });
        chapterIds = volumes.flatMap((v) => (v.chapters ?? []).map((c) => c.id));
      } catch {
        // 目录获取失败不阻塞删除
      }
      await invoke("delete_book", { bookId });
      clearCursorCache(chapterIds);
      if (localStorage.getItem("novelWriter:lastBookId") === bookId) {
        localStorage.removeItem("novelWriter:lastBookId");
      }
      const books = get().books.filter(b => b.id !== bookId);
      set({ books });
      if (get().currentBookId === bookId) {
        if (books.length > 0) {
          await get().loadBookTree(books[0].id);
        } else {
          set({ currentBookId: null, currentChapterId: null, volumes: [], currentDocNode: null });
        }
      }
    } catch (err) {
      set({ error: `删除作品失败: ${String(err)}` });
      throw err;
    }
  },

  loadBooks: async () => {
    set({ isLoading: true, error: null });
    try {
      const books = await invoke<Book[]>("list_books");
      set({ books });

      if (books.length === 0) {
        await get().createBook("未命名作品");
      } else {
        const lastBookId = localStorage.getItem("novelWriter:lastBookId");
        const targetBook = books.find((b) => b.id === lastBookId) ?? books[0];
        set({ currentBookId: targetBook.id });
        await get().loadBookTree(targetBook.id);

        const lastChapterId = localStorage.getItem("novelWriter:lastChapterId");
        const allChapters = get().volumes.flatMap((v) => v.chapters ?? []);
        if (lastChapterId && allChapters.some((c) => c.id === lastChapterId)) {
          await get().loadChapter(lastChapterId);
        }
      }
    } catch (err) {
      set({ error: `加载作品列表失败: ${String(err)}` });
    } finally {
      set({ isLoading: false });
    }
  },

  createBook: async (title, author, description) => {
    set({ error: null });
    try {
      const book = await invoke<Book>("create_book", {
        req: { title, author: author ?? "", description: description ?? "" },
      });
      set({ currentBookId: book.id });
      await get().loadBookTree(book.id);
      const books = await invoke<Book[]>("list_books");
      set({ books });
      return book;
    } catch (err) {
      set({ error: `创建作品失败: ${String(err)}` });
      throw err;
    }
  },

  createVolume: async (bookId, title) => {
    set({ error: null });
    try {
      const volume = await invoke<Volume>("create_volume", {
        req: { bookId, title },
      });
      await get().loadBookTree(bookId);
      return volume;
    } catch (err) {
      set({ error: `创建卷失败: ${String(err)}` });
      throw err;
    }
  },

  createChapter: async (volumeId, title) => {
    set({ error: null });
    try {
      const chapter = await invoke<Chapter>("create_chapter", {
        req: { volumeId, title },
      });
      const bookId = get().currentBookId;
      if (bookId) await get().loadBookTree(bookId);
      return chapter;
    } catch (err) {
      set({ error: `创建章节失败: ${String(err)}` });
      throw err;
    }
  },
  deleteVolume: async (volumeId) => {
    set({ error: null });
    try {
      await invoke("delete_volume", { volumeId });
      const bookId = get().currentBookId;
      if (bookId) await get().loadBookTree(bookId);
    } catch (err) {
      set({ error: `删除卷失败: ${String(err)}` });
      throw err;
    }
  },

  deleteChapter: async (chapterId) => {
    set({ error: null });
    try {
      await invoke("delete_chapter", { chapterId });
      clearCursorCache([chapterId]);
      if (localStorage.getItem("novelWriter:lastChapterId") === chapterId) {
        localStorage.removeItem("novelWriter:lastChapterId");
      }
      const bookId = get().currentBookId;
      if (bookId) await get().loadBookTree(bookId);
    } catch (err) {
      set({ error: `删除章节失败: ${String(err)}` });
      throw err;
    }
  },

  renameChapter: async (chapterId, title) => {
    set({ error: null });
    try {
      // update_chapter 已支持仅传 title（content/plainText 传 undefined 表示不修改正文）
      await invoke("update_chapter", { req: { id: chapterId, title } });
      const bookId = get().currentBookId;
      if (bookId) await get().loadBookTree(bookId);
    } catch (err) {
      set({ error: `重命名章节失败: ${String(err)}` });
      throw err;
    }
  },

  renameVolume: async (volumeId, title) => {
    set({ error: null });
    try {
      await invoke("rename_volume", { volumeId, title });
      const bookId = get().currentBookId;
      if (bookId) await get().loadBookTree(bookId);
    } catch (err) {
      set({ error: `重命名卷失败: ${String(err)}` });
      throw err;
    }
  },

  renameBook: async (bookId, title) => {
    set({ error: null });
    try {
      await invoke("rename_book", { bookId, title });
      // loadBooks 副作用较多（可能重建作品/切章），这里只重新拉列表并原地更新，保持 currentBookId 不变
      const books = await invoke<Book[]>("list_books");
      set({ books });
    } catch (err) {
      set({ error: `重命名作品失败: ${String(err)}` });
      throw err;
    }
  },

  moveVolume: async (bookId, volumeId, direction) => {
    set({ error: null });
    try {
      await invoke("move_volume", { req: { bookId, volumeId, direction } });
      await get().loadBookTree(bookId);
    } catch (err) {
      set({ error: `移动卷失败: ${String(err)}` });
      throw err;
    }
  },

  moveChapter: async (volumeId, chapterId, direction) => {
    set({ error: null });
    try {
      await invoke("move_chapter", { req: { volumeId, chapterId, direction } });
      const bookId = get().currentBookId;
      if (bookId) await get().loadBookTree(bookId);
    } catch (err) {
      set({ error: `移动章节失败: ${String(err)}` });
      throw err;
    }
  },



  loadBookTree: async (bookId) => {
    set({ error: null });
    try {
      const volumes = await invoke<Volume[]>("get_book_tree", { bookId });
      set({ volumes, currentBookId: bookId });
      localStorage.setItem("novelWriter:lastBookId", bookId);

      const lastChapterId = localStorage.getItem("novelWriter:lastChapterId");
      const allChapters = volumes.flatMap((v) => v.chapters ?? []);
      const targetChapter = allChapters.find((c) => c.id === lastChapterId) ?? allChapters[0];
      if (targetChapter) {
        await get().loadChapter(targetChapter.id);
      }
    } catch (err) {
      set({ error: `加载目录失败: ${String(err)}` });
    }
  },

  loadChapter: async (chapterId) => {
    set({ error: null });
    // 切换章节前先把当前章节的未保存修改落库，避免与加载新章节的竞态导致内容丢失
    if (get().currentChapterId && get().currentChapterId !== chapterId) {
      try {
        await getEditorRef()?.flushSave?.();
      } catch {
        // 保存失败不阻塞切换，编辑器仍保留原文
      }
    }
    try {
      const node = await invoke<DocNode>("get_chapter_content", { chapterId });
      set({ currentChapterId: chapterId, currentDocNode: node });
      localStorage.setItem("novelWriter:lastChapterId", chapterId);

      // Best-effort backfill of body-state snapshot for adult chapters.
      try {
        const adultMode = await invoke<boolean>("get_adult_mode");
        if (adultMode && node.content.trim().length > 100) {
          const snapshot = await invoke<string | null>("get_latest_body_state", { chapterId });
          if (!snapshot) {
            await invoke("extract_body_state", { chapterId, text: node.content });
          }
        }
      } catch {
        // Ignore backfill failures.
      }
    } catch (err) {
      set({ error: `加载章节失败: ${String(err)}` });
    }
  },

  saveChapter: async (chapterId, title, contentMarkdown, plainText) => {
    set({ error: null });
    try {
      const node = await invoke<DocNode>("update_chapter", {
        req: { id: chapterId, title, content: contentMarkdown, plainText: plainText ?? contentMarkdown },
      });
      set({ currentDocNode: node });

      const wordCount = node.wordCount;
      set({
        volumes: get().volumes.map((volume) => ({
          ...volume,
          chapters: volume.chapters?.map((chapter) =>
            chapter.id === chapterId ? { ...chapter, wordCount: wordCount, updatedAt: node.updatedAt } : chapter
          ),
        })),
      });

      // Best-effort auto-summary in the background.
      invoke("auto_summarize_chapter", { chapterId }).catch(() => {
        // Ignore background summary failures.
      });
    } catch (err) {
      set({ error: `保存失败: ${String(err)}` });
      throw err;
    }
  },
}));
