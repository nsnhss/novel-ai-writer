import type { MarkdownEditorHandle } from "@/components/editor/MarkdownEditor";

export const editorRef = {
  current: null as MarkdownEditorHandle | null,
};

export function setEditorRef(ref: MarkdownEditorHandle | null) {
  editorRef.current = ref;
}

export function getEditorRef(): MarkdownEditorHandle | null {
  return editorRef.current;
}
