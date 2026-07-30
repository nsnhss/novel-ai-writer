# 签名与发布配置说明

本文件说明如何为 `novel-ai-writer` 配置代码签名、自动更新（updater）签名以及 GitHub Release 发布所需的环境变量。

> ⚠️ 真实证书需要自行购买或通过 Apple Developer Program / SSL.com eSigner 等服务申请。本仓库只提供配置模板与占位密钥，**不要把私钥或证书提交到 Git**。

---

## 1. Tauri Updater 签名密钥

自动更新包必须使用 Ed25519 密钥对签名。

### 生成密钥对

```powershell
npm run tauri -- signer generate --password <STRONG_PASSWORD> --write-keys .tauri
```

执行后会生成：
- `.tauri` —— **私钥，必须保密**
- `.tauri.pub` —— 公钥，已写入 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`

> 建议为私钥设置强密码。Tauri 生成无密码密钥时某些版本仍会触发解密提示，使用密码更稳定。

### 本地开发/构建时提供私钥

复制 `.env.example` 为 `.env` 并填写：

```env
TAURI_SIGNING_PRIVATE_KEY=<粘贴 .tauri 文件完整内容>
TAURI_SIGNING_PRIVATE_KEY_PASSWORD=<你设置的密码>
```

或使用脚本 `scripts/build-signed.ps1`，它会自动读取 `.env` 并启动带签名的构建。

> `.env`、`.tauri`、`.pfx`、`.p12` 已加入 `.gitignore`，不会被提交。

### CI 中提供私钥

在 GitHub 仓库 Settings → Secrets and variables → Actions 中创建：
- `TAURI_SIGNING_PRIVATE_KEY`：私钥字符串
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：若生成时设置了密码则必填

---

## 2. Windows 安装包代码签名

### 方式 A：本地证书文件（PFX/P12）

```env
WINDOWS_CERTIFICATE=<base64 编码后的 PFX 文件内容>
WINDOWS_CERTIFICATE_PASSWORD=<PFX 密码>
```

将 `.pfx` 转为 base64：

```powershell
[Convert]::ToBase64String((Get-Content -Path "cert.pfx" -Encoding Byte)) | Set-Clipboard
```

### 方式 B：证书指纹（已安装到本地机器存储）

在 `src-tauri/tauri.conf.json` 的 `bundle.windows` 中配置：

```json
"windows": {
  "certificateThumbprint": "<THUMBPRINT>"
}
```

### 推荐证书来源

- EV/OV 代码签名证书：SSL.com、Sectigo、DigiCert
- 个人测试：自签名 PFX（仅本地信任）

---

## 3. macOS 代码签名与公证

需要 Apple Developer Program 的 **Developer ID Application** 证书。

### 导出证书

1. 在 Mac 的 Keychain Access 中导出 Developer ID Application 证书为 `.p12`
2. base64 编码后作为 `APPLE_CERTIFICATE` secret

### GitHub Secrets

- `APPLE_CERTIFICATE`：base64 编码的 `.p12`
- `APPLE_CERTIFICATE_PASSWORD`：导出时设置的密码
- `APPLE_SIGNING_IDENTITY`：证书在钥匙串中的 Common Name
- `APPLE_ID`：Apple ID 邮箱
- `APPLE_TEAM_ID`：Apple Team ID
- `APPLE_PASSWORD`：Apple ID 应用专用密码（App-Specific Password）

---

## 4. Linux 签名

Linux AppImage 默认不强制签名。如需签名，配置：

```env
APPIMAGE_SIGN_PASSPHRASE=<GPG 私钥密码>
```

并将 GPG 公钥/私钥导入 CI 环境。

---

## 5. 更新服务器 / latest.json

自动更新端点配置在 `src-tauri/tauri.conf.json`：

```json
"endpoints": [
  "https://github.com/YOUR_USERNAME/novel-ai-writer/releases/latest/download/latest.json"
]
```

发布时 GitHub Actions 会自动生成 `latest.json` 并上传到 Release。

本地测试可启动一个静态文件服务器，指向 `release/latest.json.template` 修改后的文件。

---

## 6. 完整发布流程

1. 更新 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 中的版本号
2. 编辑 `CHANGELOG.md` 或 release notes
3. 提交并推送 tag：
   ```bash
   git tag -a v0.2.0 -m "Release v0.2.0"
   git push origin v0.2.0
   ```
4. GitHub Actions 自动构建并创建 Draft Release
5. 检查 Draft Release，确认产物和 `latest.json` 正确后点击 **Publish release**
