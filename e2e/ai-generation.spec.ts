import { test, expect } from "./fixtures";

test.describe("AI 续写链路（mock Ollama）", () => {
  test("续写 → 流式出字 → 接受", async ({ tauriPageWithMockOllama }) => {
    const { page, mock } = tauriPageWithMockOllama;
    const bookTitle = `AI测试书_${Date.now()}`;
    const seedText = "他走出客栈，天边刚泛起鱼肚白。";

    // 1. 创建书籍（新建对话框为应用内 PromptDialog，直接填输入框）
    await page.getByRole("button", { name: /作品|book/i }).first().click();
    await page.getByRole("menuitem", { name: "新建作品" }).click();
    await page.getByRole("dialog").locator("input").fill(bookTitle);
    await page.getByRole("button", { name: /^(创建|确定)$/ }).click();
    await expect(page.getByText(/第 1 卷|新章节|第一章/).first()).toBeVisible({ timeout: 10_000 });

    // 2. 输入开头文本
    const editor = page.locator(".cm-content");
    await expect(editor).toBeVisible({ timeout: 10_000 });
    await editor.click();
    await editor.fill(seedText);
    await page.keyboard.press("Control+End");

    // 3. 点击「续写」触发流式生成
    await page.getByRole("button", { name: "续写", exact: true }).click();

    // 4. 流式文本应逐字出现在编辑器中（mock 默认返回 COMPLETION 同款文本）
    await expect(editor).toContainText("夜色渐深", { timeout: 15_000 });
    await expect(editor).toContainText("终于下定了决心", { timeout: 20_000 });

    // 5. mock 服务应收到生成请求，且使用的是默认 qwen2.5 模型
    await expect
      .poll(() => mock.generateRequests.length, { timeout: 5_000 })
      .toBeGreaterThan(0);
    const reqBody = JSON.stringify(mock.generateRequests[0]);
    expect(reqBody).toContain("qwen2.5");

    // 6. 悬停生成文本区域唤出操作条，点击「接受」保留生成结果
    await editor.locator(".cm-line").last().hover();
    const acceptBtn = page.getByTitle("接受生成结果");
    await expect(acceptBtn).toBeVisible({ timeout: 5_000 });
    await acceptBtn.click();

    // 7. 接受后文本仍在编辑器中（生成操作条消失）
    await expect(editor).toContainText("终于下定了决心");
    await expect(page.getByRole("button", { name: /接受/ })).toHaveCount(0, { timeout: 5_000 });
  });
});
