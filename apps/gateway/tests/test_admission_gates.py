import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from oakb_gateway import governance


class TestAdmissionGates(unittest.TestCase):
    """入库准入三道门：来源与 Owner / 复用与去重 / 正确性与结构化。"""

    def setUp(self):
        self.policy = governance.load_policy()
        self.rules = self.policy["admission"]

    def meta(self, **overrides):
        base = {
            "id": "kb-1",
            "type": "knowledge",
            "title": "示例",
            "status": "review",
            "source": "agent://codex",
            "origin": "agent",
            "confidence": "high",
            "sensitivity": "internal",
            "owner": "ken",
            "scope": "适用于本插件的接入配置",
            "created": "2026-01-01",
            "updated": "2026-01-01",
            "tags": [],
        }
        base.update(overrides)
        return base

    def test_a_complete_card_passes_all_gates(self):
        body = "## 核心观点\n\nAgent ID 必须绑定到令牌，因为身份由令牌决定而不是通道。"
        blockers = governance.admission_blockers(self.meta(), body, self.policy)
        self.assertEqual(blockers, [], f"本应通过却���：{blockers}")

    def test_missing_owner_is_a_veto(self):
        body = "应该使用 per-agent token，因为身份必须唯一。"
        blockers = governance.admission_blockers(self.meta(owner=""), body, self.policy)
        self.assertIn("missing owner", blockers)

    def test_missing_scope_is_a_veto(self):
        body = "应该使用 per-agent token，因为身份必须唯一。"
        blockers = governance.admission_blockers(self.meta(scope=""), body, self.policy)
        self.assertIn("missing scope", blockers)

    def test_scope_can_be_extracted_from_the_body(self):
        body = "## 适用范围\n\n仅适用于插件 0.6.0 及之后的版本。\n\n## 关键内容\n\n必须绑定令牌。"
        metadata = self.meta(scope="")
        blockers = governance.admission_blockers(metadata, body, self.policy)
        self.assertNotIn("missing scope", blockers)

    def test_expired_card_is_a_veto(self):
        body = "应该使用 per-agent token，因为身份必须唯一。"
        blockers = governance.admission_blockers(self.meta(expires_at="2020-01-01"), body, self.policy)
        self.assertTrue(any("expired" in b for b in blockers), blockers)

    def test_future_expiry_is_allowed(self):
        body = "应该使用 per-agent token，因为身份必须唯一。"
        blockers = governance.admission_blockers(self.meta(expires_at="2999-01-01"), body, self.policy)
        self.assertFalse(any("expired" in b for b in blockers), blockers)

    def test_duplicate_is_a_veto(self):
        body = "应该使用 per-agent token，因为身份必须唯一。"
        blockers = governance.admission_blockers(self.meta(duplicate_of="03-knowledge/canonical/other.md"), body, self.policy)
        self.assertTrue(any("duplicate" in b for b in blockers), blockers)

    def test_retired_state_is_a_veto(self):
        body = "应该使用 per-agent token，因为身份必须唯一。"
        blockers = governance.admission_blockers(self.meta(state="retired"), body, self.policy)
        self.assertTrue(any("state is" in b for b in blockers), blockers)

    def test_information_only_content_is_not_knowledge(self):
        """只有事实罗列、没有判断的内容，不是知识。"""
        body = "## 核心观点\n\n配置文件的路径是 /Users/ken/.codex/config.toml。"
        blockers = governance.admission_blockers(self.meta(), body, self.policy)
        self.assertIn("content contains no reusable judgment", blockers)

    def test_chinese_judgment_is_detected(self):
        """判断力检测必须覆盖中文——否则纯中文的知识卡会被全部误杀。"""
        body = "## 关键内容\n\n每个 Agent 必须使用自己的令牌，否则身份会串。"
        self.assertTrue(governance.has_judgment(body))
        self.assertEqual(governance.admission_blockers(self.meta(), body, self.policy), [])

    def test_english_judgment_is_detected(self):
        body = "## Key content\n\nEach agent must use its own token, otherwise identities collide."
        self.assertTrue(governance.has_judgment(body))

    def test_expired_card_cannot_be_promoted(self):
        # resolve() 是必需的：macOS 的临时目录是 /var -> /private/var 软链，
        # 不解析会导致 _find_object 的 relative_to 判断失败。
        root = Path(tempfile.mkdtemp(prefix="oakb-vault-")).resolve()
        (root / "03-knowledge/auto").mkdir(parents=True)
        (root / "07-maps").mkdir()
        card = root / "03-knowledge/auto" / "expired.md"
        card.write_text(
            """---
id: expired
type: knowledge
title: "过期卡"
status: review
source: agent://codex
confidence: high
sensitivity: internal
owner: ken
scope: 适用
created: 2026-01-01
updated: 2026-01-01
expires_at: 2020-01-01
tags: []
---

应该使用 per-agent token，因为身份必须唯一。
""",
            encoding="utf-8",
        )
        with patch.object(governance, "VAULT", root):
            with self.assertRaises(PermissionError) as ctx:
                governance.promote("03-knowledge/auto/expired.md")
        self.assertIn("expired", str(ctx.exception))


class TestChannelIsolation(unittest.TestCase):
    """四条通道：知识库 / Agent 配置 / 持久记忆 / 任务上下文。"""

    def test_knowledge_cards_carry_the_knowledge_channel(self):
        from oakb_gateway.governance import parse_frontmatter

        text = "---\ntype: knowledge\nchannel: knowledge\ntitle: t\n---\n\nbody"
        metadata, _body, ok = parse_frontmatter(text)
        self.assertTrue(ok)
        self.assertEqual(metadata["channel"], "knowledge")


if __name__ == "__main__":
    unittest.main()


class TestJudgmentDetectorDrift(unittest.TestCase):
    """跨语言漂移护栏：Python 与 TypeScript 两套判断力检测实现共用同一份用例。"""

    def test_shared_judgment_cases(self):
        import json
        from pathlib import Path

        cases_path = (
            Path(__file__).resolve().parents[3]
            / "packages" / "core" / "src" / "fixtures" / "judgment-cases.json"
        )
        cases = json.loads(cases_path.read_text(encoding="utf-8"))["cases"]
        self.assertTrue(cases, "共享用例为空")
        for case in cases:
            with self.subTest(case=case["id"]):
                self.assertEqual(governance.has_judgment(case["body"]), case["judgment"])
