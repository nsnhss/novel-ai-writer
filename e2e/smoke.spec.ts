import { test, expect } from "./fixtures";

test.describe("Smoke", () => {
  test("应用窗口能正常加载", async ({ tauriPage }) => {
    // 等待 React 应用渲染完成
    await expect(tauriPage.locator("#root")).toBeAttached();
    // 标题或欢迎文本应存在
    await expect(
      tauriPage.getByText(/小说|写作|novel|AI/i).first()
    ).toBeVisible({ timeout: 10_000 });
  });
});
