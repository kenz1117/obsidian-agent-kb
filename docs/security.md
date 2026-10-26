# 安全

**语言：** 中文 ｜ [English](security.en.md)

漏洞报告方式见仓库根目录的 [安全政策](../SECURITY.md)。

## 不可妥协的规则

1. Vault 必须限制在配置的根目录内。
2. Agent 身份必须来自网关配置。
3. 敏感信息必须在持久化前被拒绝。
4. HTTP 访问默认仅绑定 localhost，除非已完成明确的安全加固。
5. 除非策略明确允许公开内容，Git 远程仓库必须为私有。
6. 删除操作必须经过治理批准。

## 敏感信息控制

拒绝以下内容：

```text
私钥
API 密钥
Bearer 令牌
密码
含凭据的数据库 URI
云服务访问密钥
```

## 敏感数据

分类：

```text
public
internal
confidential
personal
secret
```

默认路由：

```text
personal       → 脱敏或评审
confidential   → 评审
secret         → 拒绝
```

## 审计

记录：

```text
操作者
agent_id
工具
输入哈希
目标路径
决策
评分
时间戳
策略版本
```

不得在审计日志中保存原始敏感信息。
