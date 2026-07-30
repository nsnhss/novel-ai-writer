import { test as base, chromium, type BrowserContext, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import net from "net";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const platform = process.platform;
const projectRoot = path.resolve(__dirname, "..");

function getTauriBinaryPath(): string {
  const ext = platform === "win32" ? ".exe" : "";
  return path.join(
    projectRoot,
    "src-tauri",
    "target",
    process.env.NODE_ENV === "production" || process.env.CI ? "release" : "debug",
    `novel-ai-writer${ext}`
  );
}

function getRemoteDebuggingEnv(port: number): NodeJS.ProcessEnv {
  const baseEnv = { ...process.env };
  switch (platform) {
    case "win32":
      baseEnv.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port=${port}`;
      return baseEnv;
    case "darwin":
      // WKWebView inspectable; requires macOS 13.3+
      baseEnv.WEBKIT_INSPECTOR_SERVER = `127.0.0.1:${port}`;
      return baseEnv;
    case "linux":
      // WebKitGTK remote inspector
      baseEnv.WEBKIT_INSPECTOR_SERVER = `127.0.0.1:${port}`;
      return baseEnv;
    default:
      throw new Error(`Unsupported platform for E2E tests: ${platform}`);
  }
}

async function waitForPort(port: number, timeout = 10_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = net.connect(port, "127.0.0.1");
        socket.once("connect", () => {
          socket.destroy();
          resolve();
        });
        socket.once("error", reject);
      });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`Timed out waiting for Tauri app remote debugging port ${port}`);
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
    server.once("error", reject);
  });
}

/** 检查端口是否已被占用（用于跳过与本机真实服务冲突的测试） */
export async function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

export interface TauriAppHandle {
  page: Page;
  context: BrowserContext;
  child: ChildProcess;
  logs: string[];
  close: () => Promise<void>;
}

/**
 * 启动一个 Tauri 应用实例并连接 WebView。
 * dataDir 为隔离的应用数据目录（同一 dataDir 可重复启动以模拟重启）。
 */
export async function launchTauriApp(
  dataDir: string,
  extraEnv: Record<string, string> = {}
): Promise<TauriAppHandle> {
  const binaryPath = getTauriBinaryPath();
  const port = await findFreePort();
  const env = getRemoteDebuggingEnv(port);

  const child: ChildProcess = spawn(binaryPath, [], {
    env: {
      ...env,
      NOVEL_WRITER_TEST_DATA_DIR: dataDir,
      ...extraEnv,
    },
    cwd: projectRoot,
    detached: false,
  });

  const logs: string[] = [];
  child.stdout?.on("data", (data) => logs.push(data.toString()));
  child.stderr?.on("data", (data) => logs.push(data.toString()));
  child.on("error", (err) => logs.push(`process error: ${err.message}`));
  child.on("exit", (code) => logs.push(`process exited with code ${code}`));

  let context: BrowserContext | undefined;
  let page: Page | undefined;

  const close = async () => {
    await page?.close().catch(() => {});
    await context?.close().catch(() => {});
    if (child && !child.killed) {
      child.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 1_000));
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }
  };

  try {
    await waitForPort(port);

    // 连接 WebView 的 CDP
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    context = browser.contexts()[0];
    if (!context) {
      context = await browser.newContext();
    }
    page = context.pages()[0] ?? (await context.newPage());

    // 等待前端应用挂载完成
    await page.waitForSelector("#root", { state: "attached", timeout: 15_000 });

    return { page, context, child, logs, close };
  } catch (err) {
    if (logs.length > 0) {
      console.error("Tauri app logs:\n", logs.join(""));
    }
    await close();
    throw err;
  }
}

type Fixtures = {
  tauriPage: Page;
  /** 带 mock Ollama 端点的应用实例（端口动态分配，不与本机真实 Ollama 冲突） */
  tauriPageWithMockOllama: {
    page: Page;
    mockEndpoint: string;
    mock: import("./mock-ollama").MockOllama;
  };
};

export const test = base.extend<Fixtures>({
  tauriPage: async ({}, use, testInfo) => {
    // 为测试隔离数据目录，避免污染用户真实数据
    const testDataDir = path.join(testInfo.outputDir, "app-data");
    const app = await launchTauriApp(testDataDir);
    try {
      await use(app.page);
    } finally {
      await app.close();
    }
  },

  tauriPageWithMockOllama: async ({}, use, testInfo) => {
    const { startMockOllama } = await import("./mock-ollama");
    const mock = await startMockOllama(0);
    const mockEndpoint = `http://127.0.0.1:${mock.port}`;
    const testDataDir = path.join(testInfo.outputDir, "app-data");
    const app = await launchTauriApp(testDataDir, {
      NOVEL_WRITER_TEST_OLLAMA_ENDPOINT: mockEndpoint,
    });
    try {
      await use({ page: app.page, mockEndpoint, mock });
    } finally {
      await app.close();
      await mock.close();
    }
  },
});

export { expect } from "@playwright/test";
