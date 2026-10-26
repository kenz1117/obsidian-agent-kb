# 治理网关

**语言：** 中文 ｜ [English](README.en.md)

用于本地 MCP、接入、治理提炼、定时任务和 Git 备份的可运行 Python 网关。

这是 Python MCP 服务器与官方 TypeScript MCP SDK 适配器共用的治理实现，负责强制执行 Agent 身份、vault 边界、写入限制、敏感信息拒绝、来源追踪和本地审计记录。

## 目录结构

```text
bin/         可执行入口
src/         网关实现
config/      本地配置与示例配置
tests/       冒烟与集成检查
```

## 运行

```bash
export KB_VAULT_ROOT=/absolute/path/to/vault
export KB_AGENT_ID=codex
bin/oakb-mcp --list-tools
bin/oakb context
```

## 定时自动化

```bash
bin/oakb-auto-ingest      # 每小时提炼来源和消息
bin/oakb-daily-sync       # 每日更新地图、索引、提交并推送
```

这些脚本会读取存在的 `config/gateway.env`。请复制 `config/gateway.env.example` 后使用，不要提交实际配置文件。
