# BUILD.md — 构建与发布指南

本文件面向开发者和维护者，说明如何从零搭建环境、本地开发、构建生产包、配置签名以及通过 GitHub Actions 发布。

## 1. 技术栈与版本要求

| 组件 | 最低版本 | 说明 |
|------|----------|------|
| Node.js | 20.x LTS | 前端构建与 npm 脚本 |
| Rust | 1.75+ | Tauri / Rust 后端 |
| Tauri CLI | 2.x | `npm install` 会安装 `@tauri-apps/cli` |
| WebView2 | 最新 | Windows 运行与构建必需 |
| Visual Studio 2022 | Community 即可 | Windows  Rust 编译必需（MSVC） |

## 2. 平台特定依赖

### Windows

1. 安装 [Node.js LTS](https://nodejs.org/)
2. 安装 [Rust](https://www.rust-lang.org/tools/install)（选择 `x86_64-pc-windows-msvc`）
3. 安装 [Visual Studio 2022](https://visualstudio.microsoft.com/)，勾选：
   - **使用 C++ 的桌面开发**
   - Windows 11 SDK 或 Windows 10 SDK
4. WebView2 在 Windows 11 中已预装；如缺失请从 [Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) 安装
5. （可选）安装 [Ollama](https://ollama.com/) 用于本地嵌入模型
6. （可选）安装 [WiX Toolset v3](https://wixtoolset.org/docs/wix3/) 与 [NSIS](https://nsis.sourceforge.io/) 以构建 MSI / NSIS 安装包；Tauri CLI 通常会自动下载，但本地预装可加速

### macOS

1. 安装 Node.js 与 Rust
2. 安装 Xcode Command Line Tools：
   ```bash
   xcode-select --install
   ```
3. 添加 macOS Rust target：
   ```bash
   rustup target add aarch64-apple-darwin x86_64-apple-darwin
   ```
4. （可选）安装 Ollama

### Linux（Ubuntu/Debian 示例）

```bash
# 基础依赖
sudo apt update
sudo apt install -y curl nodejs npm

# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# Tauri Linux 依赖
sudo apt install -y libgtk-3-dev libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf

# 如需构建 .rpm
sudo apt install -y rpm
```

## 3. 本地开发

```bash
# 克隆仓库后进入目录
cd novel-ai-writer

# 安装前端与 Tauri CLI 依赖
npm install

# 启动开发模式（自动打开窗口）
npm run tauri dev
```

开发模式会同时启动 Vite 前端服务器和 Tauri Rust 后端，默认端口：
- Vite dev server：`http://localhost:1420`
- Tauri dev HMR：`localhost:1421`

## 4. 生产构建

### 4.1 无签名构建（测试用）

```bash
npm run tauri build
```

构建产物位于：
- Windows：`src-tauri/target/release/bundle/msi/*.msi`、`src-tauri/target/release/bundle/nsis/*.exe`
- macOS：`src-tauri/target/release/bundle/dmg/*.dmg`、`src-tauri/target/release/bundle/macos/*.app`
- Linux：`src-tauri/target/release/bundle/appimage/*.AppImage`、`src-tauri/target/release/bundle/deb/*.deb`、`src-tauri/target/release/bundle/rpm/*.rpm`

### 4.2 带 updater 签名的构建

自动更新要求使用 Ed25519 密钥对 updater 包签名。项目已生成一对示例密钥：
- `.tauri` —— 私钥（已加入 `.gitignore`，不可提交）
- `.tauri.pub` —— 公钥（已写入 `src-tauri/tauri.conf.json`）

复制 `.env.example` 为 `.env`，填写：

```env
TAURI_SIGNING_PRIVATE_KEY=<粘贴 .tauri 文件完整内容>
TAURI_SIGNING_PRIVATE_KEY_PASSWORD=<私钥密码>
```

然后执行：

```powershell
# Windows
.\scripts\build-signed.ps1
```

或手动：

```bash
# Linux / macOS / Windows Git Bash
export TAURI_SIGNING_PRIVATE_KEY=$(cat .tauri)
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=<密码>
npm run tauri build
```

## 5. 代码签名

### 5.1 Windows 安装包签名

1. 购买或申请 EV/OV 代码签名证书（推荐 SSL.com、Sectigo、DigiCert）
2. 将 `.pfx`/`.p12` 证书 base64 编码：
   ```powershell
   [Convert]::ToBase64String((Get-Content -Path "cert.pfx" -Encoding Byte)) | Set-Clipboard
   ```
3. 在 `.env`（本地）或 GitHub Secrets（CI）中配置：
   ```env
   WINDOWS_CERTIFICATE=<base64 编码的证书>
   WINDOWS_CERTIFICATE_PASSWORD=<PFX 密码>
   ```

### 5.2 macOS 签名与公证

1. 加入 Apple Developer Program
2. 在 Mac 钥匙串中导出 **Developer ID Application** 证书为 `.p12`
3. base64 编码后配置：
   ```env
   APPLE_CERTIFICATE=<base64 编码的 .p12>
   APPLE_CERTIFICATE_PASSWORD=<导出密码>
   APPLE_SIGNING_IDENTITY=<证书 Common Name>
   APPLE_ID=<Apple ID 邮箱>
   APPLE_PASSWORD=<App-Specific Password>
   APPLE_TEAM_ID=<Team ID>
   ```

### 5.3 Linux AppImage GPG 签名（可选）

```env
APPIMAGE_SIGN_PASSPHRASE=<GPG 私钥密码>
```

更多细节见 [`SIGNING.md`](./SIGNING.md)。

## 6. 自动更新

更新流程：

1. 应用启动时自动访问 `tauri.conf.json` 中配置的 `endpoints`：
   ```
   https://github.com/YOUR_USERNAME/novel-ai-writer/releases/latest/download/latest.json
   ```
2. 对比 `latest.json` 中的 `version` 与当前版本。
3. 若存在新版本，下载对应平台签名包并校验签名。
4. 调用安装程序完成更新并自动重启。

发布新版本步骤：

1. 统一修改版本号：
   - `package.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/tauri.conf.json`
2. 更新 `CHANGELOG.md`
3. 提交并推送 tag：
   ```bash
   git tag -a v0.2.0 -m "Release v0.2.0"
   git push origin v0.2.0
   ```
4. GitHub Actions 自动构建所有平台并创建 Draft Release，同时生成 `latest.json`。
5. 检查 Draft Release 中的产物与签名无误后，点击 **Publish release**。

## 7. CI/CD

`.github/workflows/release.yml` 定义了发布流程：

- 触发条件：推送 `v*.*.*` tag
- 构建矩阵：
  - `windows-latest` → x86_64 MSI + NSIS
  - `macos-latest` → x86_64 + aarch64 DMG / App
  - `ubuntu-22.04` → AppImage / DEB / RPM
- 使用 `tauri-apps/tauri-action@v0` 创建 Draft Release 并上传产物
- `publish-updater-manifest` job 下载产物后生成 `latest.json` 并回传到 Release

### 需要配置的 GitHub Secrets

| Secret | 说明 |
|--------|------|
| `TAURI_SIGNING_PRIVATE_KEY` | updater 私钥字符串 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | updater 私钥密码 |
| `WINDOWS_CERTIFICATE` | Windows PFX base64（可选） |
| `WINDOWS_CERTIFICATE_PASSWORD` | Windows PFX 密码（可选） |
| `APPLE_CERTIFICATE` | macOS .p12 base64（可选） |
| `APPLE_CERTIFICATE_PASSWORD` | macOS .p12 密码（可选） |
| `APPLE_SIGNING_IDENTITY` | Developer ID Application CN（可选） |
| `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` | 公证用（可选） |

## 8. 测试

### 单元测试

```bash
# Rust 后端
cd src-tauri
cargo test

# 前端（待补充 Vitest 后）
npm run test
```

### E2E 测试

见 [`e2e/README.md`](./e2e/README.md)（待补充）。

### 安装测试

Windows 可使用：

```powershell
.\scripts\install-test.ps1 -InstallerPath "src-tauri/target/release/bundle/nsis/novel-ai-writer_0.2.0_x64-setup.exe"
```

## 9. 常见问题

### `tauri build` 提示找不到私钥

确保环境变量已正确设置：

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content .tauri -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "你的密码"
npm run tauri build
```

### Windows 构建报错缺少 WebView2

安装 [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)。

### Linux 构建报错 `webkit2gtk`

安装对应开发包：

```bash
sudo apt install libwebkit2gtk-4.1-dev
```

### macOS 构建报错 `failed to run custom build command`

确保已安装 Xcode Command Line Tools 并同意许可协议：

```bash
sudo xcodebuild -license accept
```
