# 安装 / 卸载 / 覆盖安装测试清单

本清单用于在发布前验证各平台安装包的正确性。

## 测试环境要求

- 一台未安装过 `novel-ai-writer` 的干净系统（或已彻底卸载）
- Windows 10/11 64-bit（优先）、macOS 11+、Ubuntu 22.04+/Fedora 等 Linux 发行版
- 管理员/根权限

## Windows 测试

### 1. 干净安装

- [ ] 在干净 Windows 系统上双击 MSI 或 NSIS `.exe` 安装包
- [ ] 确认安装向导可正常完成
- [ ] 确认安装目录生成：`%LOCALAPPDATA%\novel-ai-writer`
- [ ] 确认开始菜单/桌面快捷方式生成
- [ ] 确认控制面板/设置 → 应用列表中出现 `novel-ai-writer`
- [ ] 启动应用，确认能正常进入主界面
- [ ] 创建一本书、写一段文字、保存，确认 `%APPDATA%\novel-ai-writer` 或 `%LOCALAPPDATA%\novel-ai-writer` 有数据文件

### 2. 覆盖安装

- [ ] 不卸载旧版本，再次运行同一版本或更高版本的安装包
- [ ] 确认安装成功，无报错
- [ ] 启动应用，确认上次创建的书籍/数据仍然存在
- [ ] 确认注册表/卸载信息已更新为新版本

### 3. 卸载

- [ ] 通过控制面板/设置 → 应用列表卸载
- [ ] 确认安装目录被删除
- [ ] 确认开始菜单/桌面快捷方式被删除
- [ ] 确认卸载注册表项被清除
- [ ] （可选）确认用户数据目录是否保留：根据设计可保留，需文档说明

### 自动化脚本

使用 PowerShell 脚本快速执行 Windows 安装循环：

```powershell
# 以管理员身份运行 PowerShell
.\scripts\install-test.ps1 -InstallerPath "..\novel-ai-writer_0.2.0_x64-setup.exe"
```

## macOS 测试

- [ ] 在干净 macOS 系统上打开 `.dmg`
- [ ] 将应用拖入 Applications 文件夹
- [ ] 首次启动时确认 Gatekeeper 提示（未签名版本会提示“无法打开”）
- [ ] 若已签名/公证，确认可正常启动
- [ ] 确认应用数据目录：`~/Library/Application Support/novel-ai-writer`
- [ ] 确认卸载：将 `.app` 拖入废纸篓后数据是否保留/清理

## Linux 测试

### AppImage

- [ ] 下载 `.AppImage` 文件后 `chmod +x`
- [ ] 双击或在终端运行，确认启动
- [ ] 确认数据目录：`~/.local/share/novel-ai-writer` 或 `~/.config/novel-ai-writer`

### DEB / RPM

- [ ] 使用 `sudo dpkg -i` 或 `sudo rpm -i` 安装
- [ ] 确认桌面入口文件生成：`/usr/share/applications/novel-ai-writer.desktop`
- [ ] 确认可执行文件路径：`/usr/bin/novel-ai-writer`
- [ ] 卸载：`sudo apt remove novel-ai-writer` 或 `sudo rpm -e novel-ai-writer`
- [ ] 确认卸载后无残留

## 自动更新测试

1. 发布一个较低版本（如 v0.1.9）到 GitHub Release
2. 安装较低版本
3. 发布新版本（如 v0.2.0）并上传 `latest.json`
4. 启动旧版本，确认检测到更新
5. 确认可下载、安装并自动重启到新版本
6. 确认新版本数据完整保留

## 签名验证

- [ ] Windows：安装包属性 → 数字签名 → 签名者名称正确
- [ ] macOS：`codesign -dv --verbose=4 /Applications/novel-ai-writer.app` 显示正确签名身份
- [ ] Linux：AppImage 如启用 GPG 签名，`gpg --verify *.AppImage.asc`

## 失败记录模板

若测试失败，请按以下格式记录：

| 项目 | 内容 |
|------|------|
| 平台 | Windows 11 / macOS 14 / Ubuntu 24.04 |
| 安装包 | `novel-ai-writer_0.2.0_x64-setup.exe` |
| 步骤 | 干净安装 / 覆盖安装 / 卸载 |
| 现象 | 具体报错或异常 |
| 日志 | `%APPDATA%\novel-ai-writer\logs\` 或终端输出 |
| 期望 | 正常完成 |
| 实际 | 失败 |
