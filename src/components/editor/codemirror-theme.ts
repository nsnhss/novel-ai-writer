import { EditorView } from "@codemirror/view";
import { Extension } from "@codemirror/state";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/**
 * Base editor styling that adapts to CSS variables defined in the app.
 * The actual colors for light/dark are driven by `.cm-editor.light` / `.cm-editor.dark`
 * classes applied in the React wrapper.
 */
const baseTheme = EditorView.theme({
  "&.cm-editor": {
    fontSize: "16px",
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    height: "100%",
  },
  ".cm-scroller": {
    lineHeight: "1.8",
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    overflow: "auto",
  },
  ".cm-content": {
    padding: "2rem",
    minHeight: "100%",
    caretColor: "var(--foreground, currentColor)",
  },
  "&.cm-focused .cm-cursor": {
    borderLeftColor: "var(--foreground, currentColor)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "var(--primary, #3b82f6)",
    opacity: "0.25",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    borderRight: "1px solid var(--panel-border, rgba(128,128,128,0.2))",
    color: "var(--muted-foreground, #888)",
    fontSize: "12px",
    paddingLeft: "0.5rem",
    paddingRight: "0.5rem",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--muted, rgba(128,128,128,0.1))",
  },
  ".cm-activeLine": {
    backgroundColor: "var(--muted, rgba(128,128,128,0.05))",
  },
  ".cm-placeholder": {
    color: "var(--muted-foreground, #888)",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--popover, #fff)",
    color: "var(--popover-foreground, #000)",
    border: "1px solid var(--panel-border, rgba(128,128,128,0.2))",
    borderRadius: "6px",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--accent, rgba(59,130,246,0.1))",
    color: "var(--accent-foreground, #000)",
  },
});

/**
 * A minimal highlight style for Markdown. We intentionally keep it subtle
 * so that the editor remains readable for long-form novel writing.
 */
const markdownHighlightStyle = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.5em", fontWeight: "700" },
  { tag: t.heading2, fontSize: "1.3em", fontWeight: "600" },
  { tag: t.heading3, fontSize: "1.15em", fontWeight: "600" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: "var(--primary, #3b82f6)", textDecoration: "underline" },
  { tag: t.url, color: "var(--primary, #3b82f6)" },
  { tag: t.monospace, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace' },
  { tag: t.meta, color: "var(--muted-foreground, #888)" },
  { tag: t.quote, color: "var(--muted-foreground, #888)", borderLeft: "3px solid var(--border, #ccc)", paddingLeft: "1em" },
]);

export function buildEditorTheme(): Extension[] {
  return [baseTheme, syntaxHighlighting(markdownHighlightStyle)];
}
