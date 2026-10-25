# Agent 接入指南

**语言：** 中文 ｜ [English](agent-onboarding.en.md)

## 1. 安装并启用插件

只需安装 Obsidian Agent KB 插件。首次启用会创建知识目录、Agent 指令和本地 MCP 服务，无需安装其他组件。

## 2. 一键接入

打开「设置 → Obsidian Agent KB」，或点击「知识审阅」面板顶部的设置齿轮。插件只列出实际检测到应用或可执行文件的 Agent，不会把遗留配置目录当作已安装。

点击「一键接入 Agent」可自动配置 WorkBuddy、Codex、Claude Code、Trae CN、ZCode、MiniMax Code、Kimi Code、Qwen Code，以及已安装的 Claude Desktop、Cursor、Windsurf。插件保留已有 MCP 服务并备份原文件。完成后重启对应 Agent；旧版独立 MCP 用户也只需更新这一次地址。

DeepSeek Harness、Qwen Work、Doubao Work 等暂不支持配置文件自动接入的 Agent，会显示「请在应用内接入」。在对应 Agent 那一行点击「复制 Agent 接入地址」，粘贴到该应用的 MCP URL 字段即可。其他支持 MCP Streamable HTTP 的客户端也可使用自己的身份地址。不要把地址分享给别人。

每个 Agent 的地址包含独立令牌，服务端据此确定 `agent_id`。`kb_get_context` 会读取 `00-contract/agents/<agent_id>.md`，消息、候选知识、会话、提案、审计和实际连接记录都归入对应身份。从旧版通用地址升级后，再点一次「一键接入 Agent」即可切换到各自地址；已有 Profile 不会被覆盖。

「地址已配置」只表示配置写入完成，不代表真实连接成功。点击「检测服务连接」验证服务和八个工具，并在真实连接记录中查看哪个 Agent 已实际发起 MCP 连接。

后台服务随系统登录自动运行，关闭 Obsidian 不影响 Agent 使用；在插件设置中关闭服务才会停止。当前内置后台运行环境的安装包支持 macOS Apple Silicon。

## 3. 推荐会话规则

将以下内容加入 Agent 的永久指令：

```text
任务开始时，调用 kb_get_context。
需要长期保留的决策、事实和方法，通过 kb_create_inbox_card 提交。
不得直接写入 canonical 知识。
不得包含任何敏感信息。
```

## 4. 人工评审

Agent 创建的候选知识进入 `03-knowledge/auto/` 和 Obsidian 评审队列。人工先标记待审，再晋升正式知识；不合适的内容直接归档。

旧版独立 MCP 和 CLI 只用于无 Obsidian 的高级部署，不是插件用户的接入步骤。
