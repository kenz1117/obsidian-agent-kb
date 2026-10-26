# Security

**Languages:** [中文](security.md) | English

For vulnerability reporting, see the repository [security policy](../SECURITY.en.md).

## Non-negotiables

1. The vault stays inside its configured root.
2. Agent identity comes from gateway configuration.
3. Secrets are rejected before persistence.
4. HTTP access binds to localhost unless explicitly hardened.
5. Git remotes must be private unless content is public by policy.
6. Deletion requires governance approval.

## Secret controls

Reject:

```text
private keys
API keys
bearer tokens
passwords
database URIs with credentials
cloud access keys
```

## Sensitive data

Classes:

```text
public
internal
confidential
personal
secret
```

Default route:

```text
personal       → redact or review
confidential   → review
secret         → reject
```

## Audit

Store:

```text
actor
agent_id
tool
input hash
target path
decision
score
timestamp
policy version
```

Do not store raw secrets in audit logs.
