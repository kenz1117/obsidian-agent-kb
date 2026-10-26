# 架构

**语言：** 中文 ｜ [English](architecture.en.md)

默认产品只有一个客户入口：Obsidian 插件。插件内部同时承载知识运行时、MCP 服务和人工评审界面。

```text
其他 AI Agent
     │ MCP Streamable HTTP（仅本机）
     ▼
Obsidian Agent KB 插件
     ├── 知识运行时：校验、敏感信息拦截、写入、搜索、审计
     ├── MCP 服务：八个受治理工具
     └── 人工界面：审阅、晋升、归档
     ▼
当前 Obsidian Vault（Markdown）
```

## 1. 接入层

Agent 通过插件内置 MCP 服务读取和提交内容。首次启用插件时自动创建标准目录、Agent 指令和上下文文件。插件设置负责服务开关、一键 Agent 配置和通用地址复制。

## 2. 治理层

运行时负责输入边界、敏感信息拒绝、来源元数据、治理评分、候选知识路由和本地审计。Agent 只能创建候选知识、消息、会话和更新提案，不能直接晋升正式知识。

## 3. 知识层

知识以 Markdown 为原生存储，可继续使用 Obsidian、Git 和其他 Markdown 工具。

```text
auto → review → canonical → stale → archive
```

## 4. 交付层

- Agent：使用插件设置中提供的本机 MCP 地址。
- 用户：使用 Obsidian 知识评审队列。
- 高级自动化：可使用仓库保留的独立 CLI 和 Python Gateway，但不是默认产品依赖。

## 仓库结构

```text
packages/obsidian-plugin   完整客户产品：运行时、MCP、评审和接入
packages/core              独立治理模型（高级部署）
packages/mcp               旧版独立 MCP 适配器（高级部署）
packages/cli               独立命令行界面（高级部署）
apps/gateway               独立 Python 网关（高级部署）
templates/vault            标准初始 vault 示例
docs                       规范文档
config                     默认治理配置
```

## 设计规则

1. Markdown 是存储契约。
2. 默认产品以 Obsidian 插件承载界面、知识运行时和 MCP 服务；独立 Gateway 仅用于高级无界面部署。
3. Agent 不得绕过治理。
4. 正式知识必须经过人工评审或明确策略批准。
5. 每个对象都必须具有来源信息。
6. 每次变更都必须可审计。
7. 敏感数据不得进入 vault。
8. 普通客户只需要一个插件安装包，不需要理解内部运行时。
