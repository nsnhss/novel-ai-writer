# E2E 测试（Playwright + Tauri）

本目录包含基于 Playwright 的端到端测试，用于验证「创建书 → 写入 → 保存 → 数据持久化」等核心用户旅程。

## 当前覆盖范围

- `smoke.spec.ts`：应用能正常启动并渲染主界面。
- `journey.spec.ts`：创建书籍 → 输入正文 → 保存 → 验证内容持久化；以及「重启应用后内容仍在」的二次启动持久化验证。
- `ai-generation.spec.ts`：AI 续写完整链路——通过内置 mock Ollama 服务（`mock-ollama.ts`）验证「续写 → 流式出字 → 接受 → 操作条消失」，并断言生成请求使用了默认模型。
- `reliability.spec.ts`：可靠性三项——① 崩溃恢复（失焦自动保存后 SIGKILL 模拟崩溃，重启内容不丢）；② 光标恢复（重启后还原上次光标位置，打字落在正确插入点）；③ 备份恢复（`manual_backup_now` 生成的备份文件可手动覆盖主库完整还原，备份后新增数据随还原消失）。

> AI 链路测试不依赖真实模型：`launchTauriApp({ extraEnv: { NOVEL_WRITER_OLLAMA_HOST } })` 将应用内的 Ollama 地址指向测试启动的本地 mock 服务（动态空闲端口，显式监听 127.0.0.1）。

## 环境准备

1. 确保已安装 Playwright：
   ```bash
   npm install
   npx playwright install chromium
   ```
2. 确保已构建 Tauri 应用：
   ```bash
   npm run tauri:build
   # 或调试构建
   npm run tauri:build:debug
   ```

## 运行测试

```bash
# 运行所有 E2E 测试
npm run e2e

# 带 UI 调试模式
npm run e2e:ui

# 仅运行核心旅程
npx playwright test e2e/journey.spec.ts
```

## 实现说明

- 测试启动已构建的 Tauri 二进制文件，通过各平台 WebView 的远程调试端口连接。
- Windows 使用 WebView2 的 `--remote-debugging-port`。
- macOS / Linux 连接方式已预留，但当前主要在 Windows 上验证。
- 每个测试用例使用独立的数据目录（`NOVEL_WRITER_TEST_DATA_DIR`），避免污染用户真实数据。

## 扩展计划

1. ~~配置本地 Ollama 或 mock 模型后，补充「AI 续写 → 接受 → 评分」完整流程。~~（已实现，见 `ai-generation.spec.ts`）
2. 增加「导入素材 → RAG 检索」测试。
3. 覆盖设置页、模型切换、扩展包导入等路径。
