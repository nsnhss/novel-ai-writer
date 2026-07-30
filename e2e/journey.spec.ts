import { test, expect, launchTauriApp } from "./fixtures";
import path from "path";

test.describe("核心用户旅程", () => {
  test("创建书籍 → 写入内容 → 保存 → 内容持久化", async ({ tauriPage }) => {
    const bookTitle = `测试书_${Date.now()}`;
    const sampleText = "这是一个测试段落，用于验证创建、保存和重启后的数据持久化。";

    // 1. 打开作品下拉菜单并新建作品
    await tauriPage.getByRole("button", { name: /作品|book/i }).first().click();

    // 2. mock window.prompt 以绕过 WebView2 原生对话框在自动化中的限制
    await tauriPage.evaluate((title: string) => {
      window.prompt = () => title;
    }, bookTitle);
    await tauriPage.getByRole("button", { name: "新建作品" }).click();

    // 3. 等待章节加载（默认创建第一卷第一章）
    await expect(tauriPage.getByText(/第 1 卷|新章节|第一章/).first()).toBeVisible({ timeout: 10_000 });

    // 4. 点击章节进入编辑器
    const chapterButton = tauriPage.getByRole("button", { name: /新章节|第一章/ }).first();
    if (await chapterButton.isVisible().catch(() => false)) {
      await chapterButton.click();
    }

    // 5. 在 CodeMirror 编辑器中输入内容
    const editor = tauriPage.locator(".cm-content");
    await expect(editor).toBeVisible({ timeout: 10_000 });
    await editor.click();
    await editor.fill(sampleText);

    // 6. 触发保存（Ctrl+S）
    await tauriPage.keyboard.press("Control+s");

    // 7. 等待保存状态稳定（字数统计应更新）
    await expect(tauriPage.getByText(/字/).first()).toBeVisible();

    // 8. 验证编辑器中存在写入的文本
    await expect(editor).toContainText(sampleText);

    // 注：AI 续写链路见 ai-generation.spec.ts（使用 mock Ollama 服务）。
  });

  test("重启应用后内容仍在", async ({}, testInfo) => {
    const bookTitle = `重启测试书_${Date.now()}`;
    const sampleText = "这段文字用于验证应用重启后数据依然完整。";
    const dataDir = path.join(testInfo.outputDir, "restart-data");

    // ── 第一次启动：创建书籍并写入内容 ──
    let app = await launchTauriApp(dataDir);
    try {
      const page = app.page;
      await page.getByRole("button", { name: /作品|book/i }).first().click();
      await page.evaluate((title: string) => {
        window.prompt = () => title;
      }, bookTitle);
      await page.getByRole("button", { name: "新建作品" }).click();

      await expect(page.getByText(/第 1 卷|新章节|第一章/).first()).toBeVisible({ timeout: 10_000 });
      const chapterButton = page.getByRole("button", { name: /新章节|第一章/ }).first();
      if (await chapterButton.isVisible().catch(() => false)) {
        await chapterButton.click();
      }

      const editor = page.locator(".cm-content");
      await expect(editor).toBeVisible({ timeout: 10_000 });
      await editor.click();
      await editor.fill(sampleText);
      await page.keyboard.press("Control+s");
      await expect(editor).toContainText(sampleText);
      // 等待自动保存落盘
      await page.waitForTimeout(1_000);
    } finally {
      await app.close();
    }

    // ── 第二次启动（同一数据目录）：验证内容仍在 ──
    app = await launchTauriApp(dataDir);
    try {
      const page = app.page;
      // 若 localStorage 未自动恢复上次章节，则手动通过下拉选择书籍
      const editor = page.locator(".cm-content");
      const restored = await editor
        .waitFor({ state: "visible", timeout: 8_000 })
        .then(() => editor.textContent())
        .then((t) => (t ?? "").includes(sampleText))
        .catch(() => false);

      if (!restored) {
        await page.getByRole("button", { name: /作品|重启测试书|book/i }).first().click();
        await page.getByText(bookTitle, { exact: true }).first().click();
        await expect(page.getByText(/第 1 卷|新章节|第一章/).first()).toBeVisible({ timeout: 10_000 });
        const chapterButton = page.getByText(/新章节|第一章/).first();
        if (await chapterButton.isVisible().catch(() => false)) {
          await chapterButton.click();
        }
      }

      await expect(page.locator(".cm-content")).toContainText(sampleText, { timeout: 10_000 });
    } finally {
      await app.close();
    }
  });
});
