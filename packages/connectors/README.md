# 连接器

**语言：** 中文 ｜ [English](README.en.md)

连接器负责将外部平台接入受治理的输入流程。

推荐优先级：

1. 原生 MCP 客户端
2. CLI 调用
3. 文件系统发件箱
4. Webhook 连接器
5. 手动粘贴连接器

## 接口契约

每个连接器都必须生成：

```yaml
origin: connector
connector: platform-name
agent_id: stable-agent-id
task_id: optional-task-id
source_path: local-or-remote-reference
timestamp: ISO-8601
```

## 当前适配器

| 平台 | 入口 | 状态 |
|---|---|---|
| Codex | MCP stdio | 计划中 |
| Claude Code | MCP stdio | 计划中 |
| Cursor | MCP 配置 | 计划中 |
| 通用 CLI | `oakb` CLI | 可用 |
| 通用文件系统 | 收件箱监视器 | 计划中 |
