# 从 Knowledge-MCP 迁移

**语言：** 中文 ｜ [English](migration-knowledge-mcp.en.md)

私有原型已在逻辑上合并到 `apps/gateway`。

## 命令兼容映射

| 旧命令 | 新命令 |
|---|---|
| `Knowledge-MCP/bin/kb-mcp` | `apps/gateway/bin/oakb-mcp` |
| `Knowledge-MCP/bin/kb` | `apps/gateway/bin/oakb` |
| `Knowledge-MCP/bin/kb-automate` | `apps/gateway/bin/oakb-automate` |
| `Knowledge-MCP/bin/kb-auto-ingest` | `apps/gateway/bin/oakb-auto-ingest` |
| `Knowledge-MCP/bin/kb-daily-sync` | `apps/gateway/bin/oakb-daily-sync` |
| `Knowledge-MCP/bin/kb-secret-scan` | `apps/gateway/bin/oakb-secret-scan` |

## 配置映射

旧的硬编码值现已改为配置项：

| 旧值 | 新变量 |
|---|---|
| `/Users/ken/Documents/Knowledge` | `KB_VAULT_ROOT` |
| `runtime/` | `KB_RUNTIME_DIR` |
| 私有 Agent 列表 | `KB_AGENT_IDS` 或 `gateway.json.agents` |
| Codex CLI 位置 | `CODEX_BIN` |

创建配置：

```bash
cp apps/gateway/config/gateway.env.example apps/gateway/config/gateway.env
$EDITOR apps/gateway/config/gateway.env
```

然后运行：

```bash
scripts/switch-local-gateway.sh
```
