# 贡献指南

**语言：** 中文 ｜ [English](CONTRIBUTING.en.md)

## 环境设置

```bash
pnpm install
pnpm build
pnpm test
cd apps/gateway
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
pytest
```

## 开发规则

1. Markdown 是存储契约。
2. 治理变更必须同时包含模式、策略、实现和测试。
3. 不得提交真实 vault 路径、令牌、凭据或私人笔记。
4. 每个持久化对象都必须具有来源信息。
5. 晋升为正式知识必须经过人工评审或可信策略。
6. 功能性说明以中文为主文档，并为英文版提供同步更新。
