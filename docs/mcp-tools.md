# MCP 服务器与工具

**语言：** 中文 ｜ [English](mcp-tools.en.md)

从 `0.6.0` 开始，默认 MCP 服务由插件内置运行环境启动并随系统登录常驻，不需要另行安装 Python、Node、独立 MCP 或配置环境变量。当前内置后台运行环境的安装包支持 macOS Apple Silicon。

## 连接

服务使用 MCP Streamable HTTP，监听 `127.0.0.1`，默认端口为 `27183`，地址包含随机访问令牌。请在插件设置中点击「一键接入 Agent」或「复制 Agent 接入地址」，不要手工猜地址。

关闭 Obsidian 不影响后台服务；在插件设置中关闭服务才会停止。服务不向局域网或互联网开放。旧版 stdio 服务器仍保留给高级无界面部署。

## 读取工具

- `kb_get_context`：读取有界上下文包和 Agent 指令。
- `kb_search`：执行区分或不区分大小写的字面搜索。最多返回 1–50 个文件，每个文件最多五条匹配行。
- `kb_read_note`：读取一篇 Markdown 笔记，最高 256 KiB。
- `kb_get_status`：读取服务状态、Agent 档案和状态说明。

读取工具均标记为只读和幂等。

## 受治理的写入工具

- `kb_create_message`：创建传入消息。
- `kb_create_inbox_card`：在 `03-knowledge/auto/` 创建带治理评分的候选知识，直接进入 Obsidian 评审队列。
- `kb_create_session_note`：创建结果为 `completed`、`partial` 或 `failed` 的会话记录。
- `kb_propose_update`：创建可评审的更新提案，绝不直接修改目标笔记。

写入不是幂等操作；同名内容会使用不冲突的新文件名。新对象包含 Agent 来源信息和 `internal` 敏感级别。正式知识晋升只能由人工在 Obsidian 中执行。

## 访问与安全规则

1. 每个独立 URL 令牌只映射到一个白名单 `agent_id`，Agent 不能通过工具参数或请求头切换、提升身份。
2. 路径必须位于当前 Vault 内；拒绝 `..` 逃逸、外部绝对路径、`.obsidian`／`.git` 等保护目录、非 Markdown 和符号链接逃逸。
3. 单次 MCP 请求最大 2 MiB，单篇写入最大 256 KiB；写入前扫描可能的密钥。
4. 标题、标签、可选文本、整数上限和枚举值均经过校验，frontmatter 字符串会安全序列化。
5. 搜索跳过受保护目录、符号链接和大于 1 MiB 的文件。
6. 服务仅接受本机 Host／Origin，并要求随机 URL 令牌；`/health` 只返回服务状态。
7. 审计记录保存在插件本地 `runtime/audit.jsonl`，不记录笔记正文。
8. Agent 没有晋升、归档或 purge 工具，这些操作保留给人工评审界面。
