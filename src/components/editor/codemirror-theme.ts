import { EditorView } from "@codemirror/view";
import { Extension } from "@codemirror/state";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/**
 * Base editor styling that adapts to CSS variables defined in the app.
 * Typography (font size / line height / content width) is driven by
 * --editor-* variables, adjustable in 设置 → 外观.
 */
const baseTheme = EditorView.theme({
  "&.cm-editor": {
    fontSize: "var(--editor-font-size, 16px)",
    fontFamily:
      '"Source Han Serif SC", "Noto Serif SC", "Noto Serif CJK SC", "STSong", "SimSun", "Microsoft YaHei", serif',
    height: "100%",
  },
  ".cm-scroller": {
    lineHeight: "var(--editor-line-height, 1.9)",
    fontFamily:
      '"Source Han Serif SC", "Noto Serif SC", "Noto Serif CJK SC", "STSong", "SimSun", "Microsoft YaHei", serif',
    overflow: "auto",
  },
  ".cm-content": {
    padding: "2.5rem 2rem",
    minHeight: "100%",
    maxWidth: "var(--editor-max-width, 760px)",
    margin: "0 auto",
    caretColor: "var(--foreground, currentColor)",
  },
  "&.cm-focused .cm-cursor": {
    borderLeftColor: "var(--accent, currentColor)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--accent) 25%, transparent) !important",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    borderRight: "1px solid var(--border, rgba(128,128,128,0.2))",
    color: "var(--muted-foreground, #888)",
    fontSize: "12px",
    paddingLeft: "0.5rem",
    paddingRight: "0.5rem",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--muted, rgba(128,128,128,0.1))",
  },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in srgb, var(--accent) 5%, transparent)",
  },
  ".cm-placeholder": {
    color: "var(--muted-foreground, #888)",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--popover, #fff)",
    color: "var(--popover-foreground, #000)",
    border: "1px solid var(--border, rgba(128,128,128,0.2))",
    borderRadius: "8px",
    boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "color-mix(in srgb, var(--accent) 18%, transparent)",
    color: "var(--popover-foreground, #000)",
  },
});

/**
 * A minimal highlight style for Markdown. We intentionally keep it subtle
 * so that the editor remains readable for long-form novel writing.
 */
const markdownHighlightStyle = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.6em", fontWeight: "700" },
  { tag: t.heading2, fontSize: "1.35em", fontWeight: "600" },
  { tag: t.heading3, fontSize: "1.15em", fontWeight: "600" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: "var(--accent)", textDecoration: "underline" },
  { tag: t.url, color: "var(--accent)" },
  { tag: t.monospace, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace' },
  { tag: t.meta, color: "var(--muted-foreground, #888)" },
  { tag: t.quote, color: "var(--muted-foreground, #888)", borderLeft: "3px solid color-mix(in srgb, var(--accent) 55%, transparent)", paddingLeft: "1em" },
]);

export function buildEditorTheme(): Extension[] {
  return [baseTheme, syntaxHighlighting(markdownHighlightStyle)];
}
