# Vault 规范

**语言：** 中文 ｜ [English](vault-spec.en.md)

## 标准目录

```text
00-contract/      Agent 规则、术语表、决策索引
01-inbox/         原始接入材料
02-sessions/      会话记录
03-knowledge/     已提炼知识与正式知识
04-projects/      项目上下文
05-decisions/     决策记录
06-sources/       原始来源
07-maps/          索引与看板
90-archive/       非活动材料
assets/           附件
```

## 生命周期目录

```text
03-knowledge/auto/       Agent 生成
03-knowledge/reviewed/   已评审，尚未正式化
03-knowledge/canonical/  可信、可复用的知识
03-knowledge/conflicts/  冲突与争议记录
```

目录**只表达生命周期**，不表达主题。主题分类用 frontmatter 的 `tags` 表达
（常用：`ai` / `business` / `method` / `product` / `personal` / `tech`），
不要新建主题目录——那会与生命周期目录构成 N×M 分叉。

## 必需的 frontmatter

所有受治理对象都必须包含：

```yaml
---
id: kb-20260101-example
type: knowledge
title: 示例知识卡
status: auto
source: source-id-or-path
confidence: medium
created: 2026-01-01
updated: 2026-01-01
tags:
  - example
---
```

## 类型

| 类型 | 含义 |
|---|---|
| `message` | 传入的 Agent 消息 |
| `source` | 导入的原始材料 |
| `knowledge` | 已提炼的知识卡 |
| `session` | 工作会话记录 |
| `decision` | 决策记录 |
| `map` | 索引或看板 |

## 状态生命周期

```text
pending → intake → auto → review → canonical → stale → archive → purge
```

## 正式知识要求

只有满足以下条件，卡片才能移动到 `canonical`：

1. frontmatter 有效
2. 存在来源和来源追踪信息
3. 不存在重复内容
4. 不存在未解决的关键问题
5. 置信度为 `medium` 或 `high`
6. 评审策略允许自动或手动批准
