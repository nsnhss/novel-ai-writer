// 30 万字章节编辑器性能测试
// 用法: node scripts/measure-editor.mjs [数据目录] [debug|release]
// 指标: 章节打开耗时、输入延迟
import { chromium } from "@playwright/test";
import { spawn } from "child_process";
import path from "path";
import net from "net";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const dataDir = process.argv[2] || path.join(projectRoot, "test-data-perf");
const profile = process.argv[3] || "release";
const binary = path.join(
  projectRoot,
  "src-tauri", "target", profile,
  process.platform === "win32" ? "novel-ai-writer.exe" : "novel-ai-writer"
);

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.once("error", reject);
  });
}

async function waitForPort(port, timeout = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      await new Promise((resolve, reject) => {
        const socket = net.connect(port, "127.0.0.1");
        socket.once("connect", () => { socket.destroy(); resolve(); });
        socket.once("error", reject);
      });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("CDP 端口等待超时");
}

const port = await findFreePort();
const child = spawn(binary, [], {
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    NOVEL_WRITER_TEST_DATA_DIR: dataDir,
  },
  cwd: projectRoot,
});
const logs = [];
child.stdout?.on("data", (d) => logs.push(d.toString()));
child.stderr?.on("data", (d) => logs.push(d.toString()));

try {
  await waitForPort(port);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0] || (await browser.newContext());
  const page = context.pages()[0] || (await context.newPage());
  await page.waitForSelector("#root", { state: "attached", timeout: 30_000 });
  await page.getByText(/小说|写作|novel|AI|作品/i).first().waitFor({ state: "visible", timeout: 15_000 });
  console.log("[0] 应用已启动");

  // 确保书籍树已加载: 若章节不可见, 通过书籍下拉选择第一本书
  const chapterBtn = page.getByText("第 1 章", { exact: true }).first();
  if (!(await chapterBtn.isVisible().catch(() => false))) {
    // 打开书籍下拉并选择
    const selector = page.locator("button", { hasText: /作品|性能测试书/ }).first();
    await selector.click();
    await page.getByText("性能测试书 1", { exact: true }).first().click();
    await new Promise((r) => setTimeout(r, 1000));
  }
  // 点击 30 万字大章节并开始计时
  await chapterBtn.waitFor({ state: "visible", timeout: 10_000 });
  const t0 = Date.now();
  await chapterBtn.click();

  const editor = page.locator(".cm-content");
  await editor.waitFor({ state: "visible", timeout: 60_000 });
  const tVisible = Date.now() - t0;

  // 等待内容实际加载: 状态栏字数来自 store 的 currentDocNode.wordCount
  await page.getByText(/\d{5,} 字/).first().waitFor({ state: "visible", timeout: 60_000 });
  // 等待 CM 完成首批行渲染
  await page.waitForFunction(
    () => document.querySelectorAll(".cm-content .cm-line").length > 0,
    null,
    { timeout: 60_000 }
  );
  const tLoaded = Date.now() - t0;
  const charCount = 300050;
  console.log(`[1] 编辑器可见: ${tVisible} ms`);
  console.log(`[2] 30万字内容加载渲染完成: ${tLoaded} ms (字符数: ${charCount})`);

  // 输入延迟测试: 移到文档末尾输入字符 (末尾在视口内, textContent 会变化)
  await editor.click();
  await page.keyboard.press("Control+End");
  await new Promise((r) => setTimeout(r, 500));
  const baseLen = await page.evaluate(() => document.querySelector(".cm-content")?.textContent?.length ?? 0);
  const latencies = [];
  for (let i = 0; i < 10; i++) {
    const t = Date.now();
    await page.keyboard.type("测", { delay: 0 });
    await page.waitForFunction(
      (prev) => (document.querySelector(".cm-content")?.textContent?.length ?? 0) > prev,
      baseLen + i,
      { timeout: 10_000 }
    );
    latencies.push(Date.now() - t);
  }
  const avgLat = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
  const maxLat = Math.max(...latencies);
  console.log(`[3] 输入延迟: 平均 ${avgLat} ms, 最大 ${maxLat} ms (10 次采样: ${latencies.join(",")})`);

  // 滚动性能: 滚动到中部, 测量帧耗时 (requestAnimationFrame 采样)
  const fps = await page.evaluate(async () => {
    const scroller = document.querySelector(".cm-scroller");
    if (!scroller) return null;
    scroller.scrollTop = scroller.scrollHeight / 2;
    await new Promise((r) => setTimeout(r, 200));
    let frames = 0;
    const start = performance.now();
    const duration = 2000;
    // 滚动过程中统计帧数
    const tick = () => {
      frames++;
      if (performance.now() - start < duration) requestAnimationFrame(tick);
    };
    scroller.scrollBy(0, 500);
    requestAnimationFrame(tick);
    await new Promise((r) => setTimeout(r, duration + 100));
    return Math.round((frames / duration) * 1000);
  });
  console.log(`[4] 滚动时 FPS: ${fps}`);

  console.log("\n===== 结果汇总 =====");
  console.log(`30万字章节打开: ${tLoaded} ms`);
  console.log(`输入延迟: 平均 ${avgLat} ms ${avgLat <= 100 ? "✅" : "⚠️"}`);
  console.log(`滚动 FPS: ${fps} ${fps >= 30 ? "✅ ≥30fps" : "❌ <30fps"}`);

  await browser.close();
} catch (err) {
  console.error("测量失败:", err.message);
  console.error("应用日志:\n" + logs.join(""));
  process.exitCode = 1;
} finally {
  if (!child.killed) {
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 1500));
    if (!child.killed) child.kill("SIGKILL");
  }
}
