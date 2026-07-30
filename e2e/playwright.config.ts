import { defineConfig, devices } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Playwright + Tauri E2E 测试配置
 *
 * 设计思路：
 * 1. 启动已构建的 Tauri 应用二进制文件
 * 2. 通过各平台 WebView 的远程调试端口（CDP）连接
 * 3. 使用 Playwright 的 chromium.connectOverCDP 控制 WebView
 *
 * 当前优先支持 Windows（WebView2）。macOS / Linux 需要扩展对应启动参数。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: path.resolve(__dirname, "."),
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? "github" : "list",
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    actionTimeout: 10_000,
  },
  projects: [
    {
      name: "tauri-app",
      use: {
        // 这些值会在 fixture 中覆盖
        browserName: "chromium",
      },
    },
  ],
  timeout: 60_000,
});
