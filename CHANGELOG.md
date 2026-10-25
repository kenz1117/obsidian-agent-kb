# 更新日志

**语言：** 中文 ｜ [English](CHANGELOG.en.md)

## 0.6.0 - 2026-10-25

- 插件内置经校验的 Node 运行环境，并通过 macOS LaunchAgent 常驻运行；关闭 Obsidian 后，其他 Agent 仍可访问知识库。
- Agent 列表只显示实际检测到的应用或可执行文件，不再把遗留配置目录当作已安装。
- 一键接入支持 WorkBuddy、Codex、Claude Code、Trae CN、ZCode、MiniMax Code、Kimi Code 和 Qwen Code，并保留原有客户端支持。
- 每个 Agent 使用独立令牌和接入地址；上下文 Profile、写入归属、审计和连接记录均保留各自 Agent 身份，不再统一退化为 `obsidian-agent`。
- 明确区分“地址已配置”和“真实连接记录”；不支持配置文件自动接入的 Agent 显示“请在应用内接入”，并可复制自己的身份地址。
- 当前内置后台运行环境的安装包支持 macOS Apple Silicon。

## 0.5.1 - 2026-10-25

- 设置页新增 Agent 配置匹配状态、服务连接检测和实际 MCP 客户端连接记录。
- 知识评审面板新增服务状态、最近连接和设置齿轮入口。
- 明确旧版独立 MCP 用户只需重新接入一次，配置后重启 Agent 生效。

## 0.5.0 - 2026-10-25

- 将知识运行时和八个 MCP 工具完整内嵌到 Obsidian 插件，普通用户不再需要 Python、Node、独立 MCP 或 CLI 安装。
- 首次启用自动初始化知识目录、Agent 指令和上下文文件，已有笔记不会被覆盖。
- 设置页新增本机服务开关、一键配置 Claude／Cursor／Windsurf 和通用接入地址复制。
- Agent 候选知识直接进入 Obsidian 评审队列，保留敏感信息拦截、Vault 边界和审计。
- 发布流程改为单一 ZIP 安装包，标签构建可直接发布到 GitHub Releases。

## 0.4.0 - 2026-10-25

- 将 `@oakb/mcp` 接入官方 MCP SDK 和受治理的 Python 网关。
- 增加 MCP 生命周期处理、工具注解、超时、响应大小限制和端到端测试。
- 加固网关路径解析、字面搜索、输入校验、来源追踪、运行时配置和错误响应。
- 强制执行 Obsidian 晋升策略，扩展评审队列，防止移动冲突，并在 CI 中启用 TypeScript 检查。
- 实现 TypeScript CLI 的全部八个受治理命令，支持排他式 vault 初始化、有界网关子进程、稳定退出码和端到端测试。

## 0.1.0 - 2026-10-25

- 增加受治理的 vault 架构和生命周期模型。
- 增加数据治理引擎、策略模式和质量评分模型。
- 增加 MCP 工具契约。
- 增加 CLI 和 Obsidian 插件骨架。
- 从私有原型迁移可运行的 Python 网关。
