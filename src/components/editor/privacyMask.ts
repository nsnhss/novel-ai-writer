import { EditorView, ViewPlugin, ViewUpdate, Decoration, WidgetType } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

export interface PrivacyRule {
  id: string;
  pattern: string;
  replacement: string;
  isActive: boolean;
}

class MaskWidget extends WidgetType {
  constructor(private readonly text: string) {
    super();
  }

  toDOM() {
    const span = document.createElement("span");
    span.textContent = this.text;
    span.className = "privacy-mask";
    span.style.userSelect = "none";
    return span;
  }

  eq(other: MaskWidget) {
    return other.text === this.text;
  }
}

function buildDecorations(view: EditorView, enabled: boolean, rules: PrivacyRule[]) {
  if (!enabled || rules.length === 0) {
    return Decoration.none;
  }

  const builder = new RangeSetBuilder<Decoration>();
  const text = view.state.doc.toString();
  const used: Array<{ from: number; to: number }> = [];

  for (const rule of rules) {
    if (!rule.isActive || !rule.pattern) continue;

    let regex: RegExp;
    try {
      regex = new RegExp(rule.pattern, "g");
    } catch {
      continue;
    }

    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const from = match.index;
      const to = from + match[0].length;

      // Skip ranges already covered by a higher-priority rule to avoid overlaps.
      if (used.some((r) => from < r.to && to > r.from)) {
        continue;
      }
      used.push({ from, to });

      builder.add(
        from,
        to,
        Decoration.replace({
          widget: new MaskWidget(rule.replacement || "***"),
          inclusive: true,
        })
      );
    }
  }

  return builder.finish();
}

export function privacyMaskExtension(enabled: boolean, rules: PrivacyRule[]) {
  return ViewPlugin.fromClass(
    class {
      decorations = Decoration.none;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, enabled, rules);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildDecorations(update.view, enabled, rules);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  );
}
