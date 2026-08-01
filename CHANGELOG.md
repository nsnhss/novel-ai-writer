# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added — UI/UX 全面重设计（沉浸写作风）
- New visual identity: warm paper-and-ink palette with an amber accent color, in both dark and light themes; missing design tokens (`--accent`, `--destructive`, `--popover`, `--border`) added; editor selection, links, quote bars, generation highlight, scrollbars and resizers all use the accent color.
- Lightweight component layer (`src/components/ui/`): button, input, textarea, dialog, dropdown-menu, context-menu, tabs, tooltip, slider-row, badge, separator — built on already-installed Radix packages with zero new UI runtime dependencies.
- Promise-based `confirmDialog` / `promptDialog` replace all remaining native `window.confirm` / `window.prompt` calls (deletions, generation rejection, book/volume/chapter creation, API keys, rewrite instructions).
- Minimal TitleBar: book switcher dropdown + volume/chapter breadcrumb on the left; privacy toggle, theme switch, sidebar toggles and settings entry on the right. The old read-only editor header was removed.
- Settings moved out of the right sidebar into a fullscreen settings page (left group nav + content area), with new appearance options: editor font size / line height / content width.
- Directory tree overhaul: right-click context menus, inline rename for books/volumes/chapters (double-click or menu; new `rename_book` / `rename_volume` backend commands), drag-and-drop reordering via dnd-kit, persisted volume expand/collapse state, and a keyboard-accessible "more" menu per row.
- AI panel slimmed down: primary actions (continue / branch / outline / accept / reject) pinned to the top, generation params and style sliders collapsed into accordions (state persisted), generation history moved to its own segment; the 1200-line monolith was split into `src/components/ai/panel/` modules.
- Editor empty state: shows guidance instead of an endless "loading chapter…" spinner when no chapter is selected.
- UI state persistence (zustand persist): sidebar widths/collapse, active right-panel tab, volume expand state, AI panel accordions, editor typography.
- All right-sidebar panels are now keep-alive (no state loss when switching tabs).
- Star rating for generations is now shared and remembered across the editor toolbar, AI panel and rewrite dialog.

### Changed
- Ctrl+Enter continue generation now goes through the same accept/reject flow as the button (previously committed directly to the document).
- Closing the rewrite diff dialog with generated content asks for confirmation before discarding.
- Esc hierarchy: closes settings page first, then the right sidebar.

### Fixed
- Added missing TooltipProvider (would crash the app at startup when tooltips are used).

### Added
- Tauri auto-updater integration with Ed25519-signed packages.
- Multi-platform bundle targets: MSI, NSIS (Windows), DMG / App (macOS), AppImage, DEB, RPM (Linux).
- GitHub Actions release workflow for automated cross-platform builds and release notes.
- Windows install / uninstall / overwrite-install test PowerShell script.
- Signing configuration documentation and `.env.example`.
- Playwright + Tauri E2E test infrastructure (smoke + core user journey), with isolated test data directory (`NOVEL_WRITER_TEST_DATA_DIR`).
- Vitest component/unit test setup and Rust backend unit tests (chunker / tokenizer / context / vectordb).
- Performance test tooling: seed script for 10 books / 50K materials / 300K-char chapter (`scripts/seed-perf-data.py`), cold-start & memory measurement (`scripts/measure-startup.mjs`), editor performance measurement (`scripts/measure-editor.mjs`).
- E2E: restart-persistence test (second launch against the same data directory), mock Ollama server (`e2e/mock-ollama.ts`) and full AI continuation chain test (stream → accept), with `NOVEL_WRITER_TEST_OLLAMA_ENDPOINT` env override in the Rust backend.
- E2E reliability suite (`e2e/reliability.spec.ts`): crash durability (blur-autosave + SIGKILL → content survives), cursor-position restore across restarts, and backup-file restore validation (manual backup can fully replace the main database).
- Unit tests for `bookStore` (8 cases) and `generationStore` (4 cases) with mocked Tauri invoke.

### Fixed
- Auto-save debounce reduced from 30s to 5s (blur/unmount saves unchanged), shrinking the crash data-loss window.
- Editor is focused automatically after switching chapters — typing works immediately without an extra click.
- Streaming no longer yanks the view to the bottom on every token when the user has scrolled up to review earlier text; auto-follow resumes once scrolled back to the bottom.
- Word count now includes CJK punctuation and full-width symbols, matching mainstream writing-software conventions.
- Rejecting a generation, deleting a material, and deleting a generation-history record now ask for confirmation (previously one misclick destroyed content).
- All 17 native `alert()` calls replaced with a unified non-blocking toast component.
- Global shortcuts no longer call `stopPropagation`, avoiding hijacking native key handling of the editor and other components.
- Chapter outline heading parsing is memoized (no full-text split on every render).
- **Critical**: switching chapters no longer silently drops unsaved edits — `loadChapter` now awaits the editor's pending save (`flushSave`) before loading, eliminating the race with blur-triggered async saves.
- **Critical**: aborting a generation no longer leaves the editor stuck in a half-generating state — buffered tokens are flushed and the partial text stays highlighted for accept/reject (`finishGeneration`).
- **Critical**: the editor is now read-only while streaming, so typing mid-generation can no longer corrupt the insertion point of subsequent tokens.
- Editor now soft-wraps long lines instead of scrolling horizontally (`EditorView.lineWrapping`).
- A generation failure no longer rolls back the already-streamed text; partial output is kept for accept/reject, and the error is also shown in the status bar (previously only visible in the right AI panel).
- The generation toolbar is now persistent after streaming completes instead of only appearing on hover over the highlighted text.
- Switching right-sidebar tabs no longer unmounts the AI panel, preserving generation state (accept/reject actions, diagnostics, RAG query).
- **Critical**: app no longer freezes after any AI generation completes — `log_generation` called `get_active_style_profile_id()` while already holding the global SQLite mutex (non-reentrant `std::sync::Mutex`), self-deadlocking and wedging all subsequent database access.
- `generation_log` inserts no longer fail on foreign-key violation: the actual `ai_model` primary key is now resolved from provider + model name instead of storing the raw model name (found by the new AI-chain E2E; previously every generation log was silently dropped and the accept flow dead-ended with an empty logId).
- Same nested-mutex self-deadlock pattern fixed in `recommend_system_prompt_tuning` (reuses the existing connection instead of re-acquiring the lock).
- Accept generation no longer dead-ends when the backend returns an empty logId — the editor toolbar commits and resets instead of getting stuck.
- Sidebar "接受并入库 / 拒绝" buttons no longer linger after accepting/rejecting a generation via the editor toolbar (visibility now also keyed on `currentLogId` from the generation store).
- Status bar now shows a persistent "已保存 HH:mm" timestamp instead of a "已保存" label that vanished after 2 seconds; the duplicate word count in the header was removed (status bar is the single source).
- Deleting a chapter or book now also removes its cursor-position cache entries from localStorage (previously one orphaned entry per chapter accumulated forever).
- Chapter / volume / book summarization failures now surface as error toasts instead of failing silently (console only).
- Sidebar resizers no longer jump on high-DPI / multi-monitor setups: drag delta is computed from `clientX` instead of the unreliable `movementX`.
- The generation toolbar's star rating now remembers the last chosen value (localStorage) instead of resetting to 3 stars on every generation.

### Changed
- Vector embeddings now stored as binary BLOB instead of JSON text (~46% smaller database, faster cache warmup); old JSON data is read transparently, new writes use BLOB. `scripts/backfill-embedding-blob.py` migrates existing data.
- In-memory vector cache uses f16 half precision, halving cache RAM (~205MB → ~103MB at 50K vectors); 50K search still ~88ms.
- Daily backup no longer blocks app startup: runs on a background thread with its own DB connection, writes to a temp file then renames.
- Backup throughput greatly improved (4096 pages/step + 5ms pause instead of 100 pages/250ms — a 400MB backup now takes seconds instead of minutes).

### Performance (measured, Windows release build)
- Cold start (10 books / 50K materials): ~1.7s (requirement ≤3s).
- Vector search 50K×1024: 88ms (requirement ≤200ms).
- Editor with 300K-char chapter: open ~50ms, typing latency ~43ms, scrolling ~91fps (requirement ≥30fps).
- Idle memory: ~590MB with 50K vectors loaded (~430MB of that is the WebView2 runtime baseline). Note: the original ≤150MB target is not achievable for a WebView2-based app and should be revised.

## [0.2.0] - 2026-07-17

### Added
- Initial public beta release.
- 三栏式 Markdown 编辑器 + AI 续写 / 改写面板。
- 本地素材库：TXT/EPUB 导入、自动切片、标签分类、RAG 语义检索。
- DeepSeek API 与 Ollama 本地模型双引擎支持。
- 角色卡 / 场景卡管理。
- 风格画像与风格漂移评估。
- 成人内容扩展基础设施（Seed 扩展包，不内置任何具体成人内容数据）。
- 隐私模式、脱敏过滤器链、禁区黑名单。
- SQLite 本地存储（FTS5 + 向量 BLOB），零网络遥测。

## [0.1.0] - 2026-06-27

### Added
- Project scaffold with Tauri 2 + React 19 + TypeScript.
- Basic CodeMirror 6 editor and book/volume/chapter tree.
