# Obsidian 插件

**语言：** 中文 ｜ [English](README.en.md)

完整的本地 Agent 知识库：安装这一个插件即可获得知识运行时、MCP 服务、自动初始化和人工评审，不需要其他组件。当前发布包支持 macOS Apple Silicon。

## 安装与接入

1. 将发布 ZIP 解压到 `<vault>/.obsidian/plugins/`，得到包含 `manifest.json`、`main.js`、`service.js`、`service-node` 和 `styles.css` 的 `obsidian-agent-kb` 目录。
2. 在 Obsidian 中启用插件，等待自动初始化和后台服务启动完成。
3. 在插件设置或「知识审阅」面板齿轮中点击「一键接入 Agent」，或复制通用 MCP 地址。
4. 重启 Agent。旧用户只需更新一次地址，之后无需重复接入。

## 功能

- 内置八个 MCP 工具，直接读写当前 Vault。
- Agent 候选知识进入 `03-knowledge/auto/` 和评审队列。
- 展示治理评分、状态、置信度、来源和标签。
- 人工标记待审、晋升正式知识和归档。
- 只显示实际检测到的 Agent；自动配置 WorkBuddy、Codex、Claude Code、Trae CN、ZCode、MiniMax Code、Kimi Code、Qwen Code 及原有支持的客户端，修改前备份原配置。
- 每个 Agent 使用独立身份地址，Profile、写入归属、审计和连接记录均保留对应 `agent_id`。
- 明确区分地址配置与真实连接记录；需要应用内接入的 Agent 可复制自己的身份地址。
- 服务仅监听 `127.0.0.1`，地址含随机访问令牌。
- 路径逃逸和敏感信息拦截，本地审计记录。

后台服务随系统登录自动运行，关闭 Obsidian 不影响 Agent 使用；可在插件设置中手动停止。
