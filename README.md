# Obsidian Agent KB

**语言：** 中文 ｜ [English](README.en.md)

**一个 Obsidian 插件，让其他 AI Agent 共享你的本地知识库。**

知识仍是你自己的 Markdown 文件。Agent 可以搜索、读取和提交知识；你只需在 Obsidian 中审核，决定是否成为正式知识。

## 你只需要安装一个插件

不需要安装 Python、Node、独立 MCP 服务器或 CLI，也不需要手动配置仓库路径。当前安装包内置 macOS Apple Silicon 后台运行环境。

### 安装

1. 从 GitHub Release 下载 `obsidian-agent-kb-<版本>.zip`。
2. 将 ZIP 解压到当前 Vault 的 `.obsidian/plugins/` 目录。
3. 确认存在 `.obsidian/plugins/obsidian-agent-kb/main.js`。
4. 在 Obsidian「设置 → 第三方插件」中启用 **Obsidian Agent KB**。

首次启用会自动初始化知识目录、Agent 指令和后台服务，已有笔记不会被覆盖。

### 接入 Agent

1. 打开「设置 → Obsidian Agent KB」，也可以点击「知识审阅」面板顶部的设置齿轮。
2. 确认「后台服务运行中」。
3. 点击「一键接入 Agent」。插件只处理实际检测到的 Agent，并在修改配置前备份。
4. 重启对应 Agent。旧版独立 MCP 用户也只需更新这次地址，之后无需重复接入。

不支持配置文件自动接入的 Agent 会明确显示「请在应用内接入」。其他支持 MCP Streamable HTTP 的客户端，可点击「复制 Agent 接入地址」，将地址作为 MCP URL 添加。「地址已配置」不等于已真实连接，真实连接以连接记录为准。

**后台服务随系统登录自动运行，关闭 Obsidian 不影响 Agent 使用；在插件设置中关闭服务才会停止。**

## 日常使用

```text
Agent 搜索和读取 Vault
        ↓
Agent 提交候选知识
        ↓
Obsidian「知识审阅」队列
        ↓
人工晋升正式知识或归档
```

- `03-knowledge/auto/`：Agent 提交的候选知识。
- `03-knowledge/reviewed/`：等待最终确认的笔记。
- `03-knowledge/canonical/`：人工批准的正式知识。
- `90-archive/governance/manual/`：手动归档内容。

## 内置能力

- 八个 MCP 工具：上下文、搜索、读取、状态、消息、候选知识、会话和更新提案。
- Agent 只能创建候选内容或提案，不能直接修改正式知识。
- 敏感信息写入拦截、Vault 路径边界、本机访问令牌和本地审计。
- 中文／英文评审界面、治理评分、晋升和归档。

详见 [Agent 接入指南](docs/agent-onboarding.md) 和 [MCP 工具](docs/mcp-tools.md)。

## 发布与开发

维护者生成同一个客户安装包：

```bash
pnpm install --frozen-lockfile
scripts/fetch-obsidian-service-runtime.sh
scripts/package-obsidian-plugin.sh
```

运行环境脚本从 Node.js 官方下载固定版本并强制核验 SHA-256；大型二进制不提交到仓库。产物位于 `dist/obsidian-agent-kb-<版本>.zip`。推送 `v*` 标签时，CI 会测试、下载运行环境、打包并上传到 GitHub Release。

仓库中的独立 Python Gateway、TypeScript MCP 和 CLI 仅保留给需要无 Obsidian 部署的高级场景，不是普通客户的安装步骤。

完整验证：

```bash
pnpm check
```

## 当前状态

`0.6.x`——单一插件安装、自动初始化、后台常驻 MCP、一键 Agent 接入和人工评审均可用。

## 许可证

Apache-2.0。
