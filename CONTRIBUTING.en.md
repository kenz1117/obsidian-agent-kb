# Contributing

**Languages:** [中文](CONTRIBUTING.md) | English

## Setup

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

## Rules

1. Markdown is the storage contract.
2. Governance changes require schema, policy, implementation, and tests.
3. Never commit real vault paths, tokens, credentials, or private notes.
4. Every durable object requires provenance.
5. Canonical promotion requires review or trusted policy.
6. Functional documentation uses Chinese as its primary language; keep the English version synchronized.
