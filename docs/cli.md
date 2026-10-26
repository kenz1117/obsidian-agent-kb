# TypeScript CLI

**语言：** 中文 ｜ [English](cli.en.md)

`@oakb/cli` 为 MCP 和 Obsidian 插件共用的 Python 治理网关提供本地、可脚本化的接口，不维护另一套治理实现。

## 构建与运行

```bash
pnpm install
pnpm --filter @oakb/cli build
node packages/cli/dist/index.js --help
```

链接工作区包后，可执行命令为 `oakb`。

## 配置

| 变量 | 用途 |
|---|---|
| `KB_VAULT_ROOT` | 绝对路径或相对于用户目录的 vault 路径 |
| `KB_RUNTIME_DIR` | 运行时审计目录 |
| `KB_AGENT_ID` | 当前已注册的 Agent 身份 |
| `KB_AGENT_IDS` | 以逗号分隔的已注册 Agent 身份列表 |
| `OAKB_GATEWAY_BIN` | 可选，覆盖网关 `bin` 目录 |
| `OAKB_PYTHON` | 可选 Python 可执行文件，默认为 `python3` |

`--agent <id>` 会覆盖 `KB_AGENT_ID`。成功的命令数据以 JSON 输出到 stdout，诊断信息输出到 stderr。虽然输出始终为 JSON，仍可显式使用 `--json` 表明脚本化意图。

## 命令

```text
oakb init [path]
oakb [--agent <id>] doctor
oakb [--agent <id>] ingest
oakb [--agent <id>] distill
oakb [--agent <id>] review [--scan]
oakb [--agent <id>] promote <target> [--reviewer <name>]
oakb [--agent <id>] archive <target> [--reason <text>]
oakb [--agent <id>] status
```

- `init` 通过排他式文件创建复制受治理的 vault 模板，绝不覆盖已有文件和符号链接目标项。
- `doctor` 报告 vault、策略和知识安全问题。当有效 JSON 报告包含 `ok: false` 时，退出码为 `1`。
- `ingest` 根据现有收件箱内容生成 `07-maps/INBOX-REVIEW.md`，不调用 AI 模型。
- `distill` 对知识卡执行现有治理扫描，包括校验、评分、重复处理、评审路由和归档；不合成新知识，也不执行 Git 操作。
- `review` 返回评审地图位置；`review --scan` 会先刷新治理结果。
- `promote` 和 `archive` 将生命周期策略及审计行为委托给网关。
- `status` 读取当前 Agent 的注册与 vault 状态，并记录 CLI 状态审计事件。

独立的 `oakb-auto-ingest` Agent 自动化仍需显式启用，这些命令不会调用它。因此，外部 Agent 和 Git 行为不会成为常规 CLI 使用的隐藏副作用。

## 退出码

| 退出码 | 含义 |
|---|---|
| `0` | 命令成功完成 |
| `1` | 网关、健康检查、文件系统或生命周期操作失败 |
| `2` | 命令行用法错误 |

网关子进程不经过 shell 执行，超时为 30 秒，每个输出流的大小上限为 4 MiB。
