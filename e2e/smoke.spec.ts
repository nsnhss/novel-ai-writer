import { test, expect } from "./fixtures";

test.describe("Smoke", () => {
  test("应用窗口能正常加载", async ({ tauriPage }) => {
    // 等待 React 应用渲染完成
    await expect(tauriPage.locator("#root")).toBeAttached();
    // 顶栏书籍切换按钮渲染即说明应用正常加载（避免匹配到 dnd-kit 的隐藏无障碍文本）
    await expect(
      tauriPage.getByRole("button", { name: /作品|book/i }).first()
    ).toBeVisible({ timeout: 10_000 });
  });
});
