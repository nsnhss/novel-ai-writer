import { test, expect, launchTauriApp } from "./fixtures";
import type { Page } from "@playwright/test";
import path from "path";
import fs from "fs";

/** 创建一本新书并等待编辑器就绪；triggerName 为左上角书籍菜单触发按钮的名称（无书时显示“作品”，有书时显示当前书名） */
async function createBookAndOpenEditor(page: Page, title: string, triggerName: string | RegExp = /作品|book/i) {
  await page.getByRole("button", { name: triggerName }).first().click();
  await page.evaluate((t: string) => {
    window.prompt = () => t;
  }, title);
  await page.getByRole("button", { name: "新建作品" }).click();
  await expect(page.getByText(/第 1 卷|新章节|第一章/).first()).toBeVisible({ timeout: 10_000 });
  const editor = page.locator(".cm-content");
  await expect(editor).toBeVisible({ timeout: 10_000 });
  return editor;
}

test.describe("可靠性收尾", () => {
  test("崩溃恢复：失焦自动保存后异常杀进程，内容不丢", async ({}, testInfo) => {
    test.setTimeout(90_000);
    const dataDir = path.join(testInfo.outputDir, "app-data");
    const text = "夜深人静，他提笔写下第一行字。";

    // 第一次启动：输入内容，失焦触发立即保存，然后 SIGKILL 模拟崩溃
    const app1 = await launchTauriApp(dataDir);
    const editor1 = await createBookAndOpenEditor(app1.page, `崩溃测试_${Date.now()}`);
    await editor1.click();
    await editor1.fill(text);
    // 编辑器失焦 → 触发 blur 即存（不等 30s 防抖）
    await app1.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await app1.page.waitForTimeout(2_000);
    app1.child.kill("SIGKILL");
    await new Promise((r) => setTimeout(r, 1_000));

    // 第二次启动（同一数据目录）：内容应仍在
    const app2 = await launchTauriApp(dataDir);
    try {
      const editor2 = app2.page.locator(".cm-content");
      await expect(editor2).toContainText("提笔写下第一行字", { timeout: 15_000 });
    } finally {
      await app2.close();
    }
  });

  test("光标恢复：重启后还原上次光标位置", async ({}, testInfo) => {
    test.setTimeout(90_000);
    const dataDir = path.join(testInfo.outputDir, "app-data");
    const seed = "一二三四五六七八九十";
    const cursorAt = 3;

    // 第一次启动：输入文本并把光标移到第 3 个字符后，正常退出
    const app1 = await launchTauriApp(dataDir);
    const editor1 = await createBookAndOpenEditor(app1.page, `光标测试_${Date.now()}`);
    await editor1.click();
    await editor1.fill(seed);
    await app1.page.keyboard.press("Control+Home");
    for (let i = 0; i < cursorAt; i++) {
      await app1.page.keyboard.press("ArrowRight");
    }
    await app1.page.keyboard.press("Control+s"); // 保存内容（光标位置独立于保存）
    await app1.page.waitForTimeout(1_000);
    await app1.close();

    // 第二次启动：焦点放回编辑器（不改变选区），打字应插入到上次光标处
    const app2 = await launchTauriApp(dataDir);
    try {
      const editor2 = app2.page.locator(".cm-content");
      await expect(editor2).toContainText(seed, { timeout: 15_000 });
      await editor2.focus();
      await app2.page.keyboard.type("X");
      const expected = seed.slice(0, cursorAt) + "X" + seed.slice(cursorAt);
      await expect(editor2).toContainText(expected, { timeout: 5_000 });
    } finally {
      await app2.close();
    }
  });

  test("备份恢复：手动备份文件可完整还原数据", async ({}, testInfo) => {
    test.setTimeout(90_000);
    const dataDir = path.join(testInfo.outputDir, "app-data");
    const ts = Date.now();
    const bookKept = `备份保留_${ts}`;
    const bookGone = `备份后新增_${ts}`;

    // 第一次启动：创建书 A 并保存 → 手动备份 → 再创建书 B（备份后新增）→ 正常退出
    const app1 = await launchTauriApp(dataDir);
    const editor1 = await createBookAndOpenEditor(app1.page, bookKept);
    await editor1.click();
    await editor1.fill("这是应该被备份下来的内容。");
    await app1.page.keyboard.press("Control+s");
    await app1.page.waitForTimeout(1_000);
    // 与设置面板「立即备份」按钮调用的是同一个后端命令
    await app1.page.evaluate(() => (window as any).__TAURI_INTERNALS__.invoke("manual_backup_now"));
    // 第二本书：菜单触发按钮此时显示书 A 的标题
    await createBookAndOpenEditor(app1.page, bookGone, bookKept);
    await app1.close();

    // 模拟用户手动恢复：用备份文件覆盖主库
    const backupsDir = path.join(dataDir, "backups");
    const backupFile = fs
      .readdirSync(backupsDir)
      .filter((f) => f.startsWith("novel_ai_writer_") && f.endsWith(".db"))
      .sort()
      .pop();
    expect(backupFile).toBeTruthy();
    const dbPath = path.join(dataDir, "novel_ai_writer.db");
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(dbPath + suffix, { force: true });
    }
    fs.copyFileSync(path.join(backupsDir, backupFile!), dbPath);

    // 第二次启动：书 A 应在，书 B（备份后新增）应不存在
    const app2 = await launchTauriApp(dataDir);
    try {
      await expect(app2.page.getByText(bookKept).first()).toBeVisible({ timeout: 15_000 });
      expect(await app2.page.getByText(bookGone).count()).toBe(0);
    } finally {
      await app2.close();
    }
  });
});
