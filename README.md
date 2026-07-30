# AI 小说写作

一款**本地优先**的 AI 辅助小说写作桌面应用。

> 你的 AI 越写越像你。

## 核心特点

- **完全本地**：所有文稿、素材库、设置均保存在本地设备，不上传任何内容
- **零网络遥测**：没有任何 analytics / telemetry / track 调用
- **风格培养**：通过导入参考作品、RAG 语义检索、评分反馈，让 AI 逐步贴合你的写作风格
- **AI 续写 / 改写**：基于 DeepSeek API 或本地 Ollama 模型，流式输出、随时中断
- **成人内容扩展基础设施**：通过外部 Seed 扩展包注入标签、场景模板、角色字段，应用本体不内置任何具体成人内容
- **多平台**：支持 Windows 10/11、macOS 11+、Linux

## 下载与安装

1. 访问 [Releases](https://github.com/YOUR_USERNAME/novel-ai-writer/releases) 页面。
2. 下载对应系统的安装包：
   - **Windows**：`novel-ai-writer_x64-setup.exe`（推荐）或 `.msi`
   - **macOS**：`.dmg`
   - **Linux**：`.AppImage`、`.deb` 或 `.rpm`
3. 运行安装包并按向导完成安装。
4. 首次启动后，进入「设置 → 关于」可手动检查更新。

> Windows 安装时如遇到 SmartScreen 提示，是因为安装包尚未积累足够声誉。点击「更多信息 → 仍要运行」即可。

## 快速开始

### 1. 配置 AI 模型

首次打开应用后：

1. 点击右上角设置图标，进入「模型 / API」标签。
2. 选择 **DeepSeek API**（默认推荐）：
   - 填入你的 [DeepSeek API Key](https://platform.deepseek.com/)
   - 点击「测试连接」确认可用
3. 或选择 **Ollama** 作为本地降级方案：
   - 确保本地已运行 Ollama
   - 在模型列表中选择已安装的模型

### 2. 创建第一本书

1. 在左侧目录面板点击「新建书籍」。
2. 输入书名和简介，点击确认。
3. 系统会自动创建默认的卷和第一章。

### 3. 开始写作

1. 点击左侧章节进入编辑界面。
2. 在编辑器中写下开头。
3. 将光标放在想要续写的位置，按 `Ctrl + Enter` 或点击「续写」按钮。
4. AI 会流式生成后续内容；你可以：
   - **接受**：保留生成内容
   - **拒绝**：删除生成内容
   - **重新生成**：换一版结果
   - **评分**：1-5 星，4-5 星会自动进入素材库

### 4. 导入参考作品（可选，但强烈建议）

1. 进入「素材库」面板。
2. 拖拽 TXT / EPUB 文件到窗口，或使用「导入」按钮。
3. 系统会自动：
   - 检测 UTF-8 / GBK 编码
   - 按段落切片
   - 生成嵌入向量
   - 自动打标签
4. 导入完成后，续写时会自动检索相似段落作为风格参考。

### 5. 使用扩展包（可选）

1. 准备好 `seed.json` 扩展包文件。
2. 进入「设置 → 扩展包」，点击「导入扩展包」。
3. 预览并确认后，标签、场景模板、角色扩展字段等内容会写入本地数据库。

> 扩展包完全可选，不导入时应用保持纯净。

## 隐私与安全

本软件为个人写作辅助工具，运行在用户本地设备。

- 所有数据存储在本地，不上传任何内容至第三方服务器
- AI 调用仅发送当前写作上下文到你配置的 API Endpoint（DeepSeek / Ollama）
- API Key 使用操作系统原生加密存储（Windows Credential Manager / macOS Keychain / Linux keyring）
- 数据库可选 SQLCipher 加密
- 用户对使用本软件创作的内容负全部责任
- 请遵守所在地法律法规
- 本软件仅供个人学习与创作使用

## 常用快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl + S` | 保存当前章节 |
| `Ctrl + Enter` | AI 续写 |
| `Ctrl + Shift + Enter` | AI 改写选中内容 |
| `Ctrl + Z` / `Ctrl + Y` | 撤销 / 重做 |
| `Ctrl + F` | 查找 |
| `Esc` | 关闭面板 |

> 快捷键可在「设置 → 快捷键」中自定义。

## 开发构建

如果你是开发者，想从源码构建，请参考 [`BUILD.md`](./BUILD.md)。

简版：

```bash
npm install
npm run tauri dev      # 开发模式
npm run tauri build    # 生产构建
```

## 目录结构

```
novel-ai-writer/
├── src/                    # React + TypeScript 前端
│   ├── components/         # UI 组件
│   ├── stores/             # Zustand 状态管理
│   └── lib/                # 工具函数
├── src-tauri/              # Tauri 2 + Rust 后端
│   └── src/
│       ├── commands/       # IPC 命令
│       ├── db/             # SQLite 数据层
│       ├── embeddings/     # 嵌入模型接口
│       ├── llm/            # AI 模型调用
│       ├── parser/         # TXT/EPUB 解析
│       └── vectordb/       # 向量检索
├── scripts/                # 构建与测试脚本
├── release/                # 发布相关模板
└── CHANGELOG.md            # 版本日志
```

## 更新日志

见 [`CHANGELOG.md`](./CHANGELOG.md)。

## 许可证

本项目仅供个人学习与创作使用。
