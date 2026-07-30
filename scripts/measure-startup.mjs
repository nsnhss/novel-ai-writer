// 冷启动与内存测量脚本
// 用法: node scripts/measure-startup.mjs [数据目录] [debug|release]
// 指标: 进程启动 → WebView CDP 就绪 → #root 挂载; 空闲内存(进程树)
import { chromium } from "@playwright/test";
import { spawn, execSync } from "child_process";
import path from "path";
import net from "net";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const dataDir =
  process.argv[2] || path.join(projectRoot, "test-data-perf");
const profile = process.argv[3] || "release";
const binary = path.join(
  projectRoot,
  "src-tauri",
  "target",
  profile,
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
        socket.once("connect", () => {
          socket.destroy();
          resolve();
        });
        socket.once("error", reject);
      });
      return Date.now() - start;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("CDP 端口等待超时");
}

function processTreeMemoryMB(rootPid) {
  // 递归累加进程树 WorkingSet (主进程 + WebView2 子进程)
  const ps = `
$root = ${rootPid}
$all = @(Get-CimInstance Win32_Process -Filter "Name='novel-ai-writer.exe' OR Name='msedgewebview2.exe'" | Select-Object ProcessId, ParentProcessId, WorkingSetSize, Name)
$sum = [long]0
$queue = New-Object 'System.Collections.Generic.Queue[int]'
$queue.Enqueue($root)
$seen = @{}
while ($queue.Count -gt 0) {
  $cur = $queue.Dequeue()
  if ($seen.ContainsKey($cur)) { continue }
  $seen[$cur] = $true
  foreach ($p in $all) { if ($p.ProcessId -eq $cur) { $sum += [long]$p.WorkingSetSize } }
  foreach ($c in $all) { if ($c.ParentProcessId -eq $cur -and $c.Name -match 'webview|novel') { $queue.Enqueue([int]$c.ProcessId) } }
}
[math]::Round($sum / 1MB, 1)
`;
  const encoded = Buffer.from(ps, "utf16le").toString("base64");
  const out = execSync(`powershell -NoProfile -EncodedCommand ${encoded}`, {
    encoding: "utf-8",
  }).trim();
  return parseFloat(out);
}

const port = await findFreePort();
console.log(`二进制: ${binary} (${profile})`);
console.log(`数据目录: ${dataDir}`);

const t0 = Date.now();
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
  const cdpMs = await waitForPort(port);
  console.log(`[1] WebView CDP 就绪: ${cdpMs} ms`);

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0] || (await browser.newContext());
  const page = context.pages()[0] || (await context.newPage());

  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType("navigation")[0];
    return n
      ? { domContentLoaded: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), responseEnd: Math.round(n.responseEnd) }
      : null;
  }).catch(() => null);
  if (nav) console.log(`    页面导航: responseEnd=${nav.responseEnd}ms DCL=${nav.domContentLoaded}ms load=${nav.load}ms (页面内时钟)`);

  await page.waitForSelector("#root", { state: "attached", timeout: 30_000 });
  const mountMs = Date.now() - t0;
  console.log(`[2] #root 挂载完成(冷启动): ${mountMs} ms`);

  // 等待首屏实际渲染内容
  await page
    .getByText(/小说|写作|novel|AI|作品/i)
    .first()
    .waitFor({ state: "visible", timeout: 15_000 });
  console.log(`[3] 首屏内容可见: ${Date.now() - t0} ms`);

  // 空闲 5 秒让后台向量缓存预热, 然后测内存
  await new Promise((r) => setTimeout(r, 5000));
  const memIdle = processTreeMemoryMB(child.pid);
  console.log(`[4] 空闲内存(进程树, 含向量缓存预热): ${memIdle} MB`);

  // 再观察 10 秒看内存是否继续上涨(向量缓存全量加载)
  await new Promise((r) => setTimeout(r, 10_000));
  const memSettled = processTreeMemoryMB(child.pid);
  console.log(`[5] 稳定内存(+10s): ${memSettled} MB`);

  console.log("\n===== 结果汇总 =====");
  console.log(`冷启动(spawn→#root): ${mountMs} ms  ${mountMs <= 3000 ? "✅ ≤3000ms" : "❌ >3000ms"}`);
  console.log(`空闲内存: ${memSettled} MB  ${memSettled <= 150 ? "✅ ≤150MB" : "⚠️ >150MB (含 50K 向量缓存)"}`);

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
