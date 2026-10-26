import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from oakb_gateway import governance


class TestCanonicalStability(unittest.TestCase):
    """已人工批准并晋升的正式知识，不应被后续扫描降级回待审队列。"""

    def make_vault(self):
        root = Path(tempfile.mkdtemp(prefix="oakb-vault-"))
        (root / "03-knowledge/auto").mkdir(parents=True)
        (root / "03-knowledge/reviewed").mkdir(parents=True)
        (root / "03-knowledge/canonical").mkdir(parents=True)
        (root / "07-maps").mkdir()
        return root

    def make_canonical(self, root: Path, name: str, title: str, body: str):
        path = root / "03-knowledge/canonical" / name
        path.write_text(f"""---
id: {path.stem}
type: knowledge
title: "{title}"
status: canonical
source: agent://codex
confidence: high
sensitivity: internal
created: 2026-01-01
updated: 2026-01-01
governance_score: 95
governance_decision: auto-promoted
tags:
  - test
---

{body}
""", encoding="utf-8")
        return path

    def test_approved_canonical_card_is_not_demoted(self):
        vault = self.make_vault()
        card = self.make_canonical(
            vault,
            "approved.md",
            "Agent ID is stable across transports",
            "Decision: the Agent ID stays stable across every transport because identity is bound to the token, not the channel.",
        )
        with patch.object(governance, "VAULT", vault):
            result = governance.scan()

        self.assertTrue(card.exists(), "已批准的正式知识被移出了 canonical/")
        self.assertEqual(
            card.parent.name,
            "canonical",
            "已批准的正式知识被降级回了其他目录",
        )
        self.assertEqual(result["archived"], 0)

    def test_approved_canonical_card_keeps_its_status(self):
        vault = self.make_vault()
        card = self.make_canonical(
            vault,
            "approved2.md",
            "Per-agent token maps to one identity",
            "Decision: each agent gets its own token so the server can attribute the caller without shared credentials.",
        )
        with patch.object(governance, "VAULT", vault):
            governance.scan()

        text = card.read_text(encoding="utf-8")
        self.assertIn("status: canonical", text)
        self.assertIn("governance_decision: auto-promoted", text)

    def test_canonical_card_marked_as_duplicate_is_still_archived(self):
        vault = self.make_vault()
        self.make_canonical(
            vault,
            "dup-canonical.md",
            "Shared knowledge note",
            "This body is intentionally identical to the other card so the duplicate check can catch it.",
        )
        other = vault / "03-knowledge/reviewed" / "dup-new.md"
        other.write_text(
            """---
id: dup-new
type: knowledge
title: "Shared knowledge note"
status: review
source: agent://codex
confidence: high
sensitivity: internal
created: 2026-01-01
updated: 2026-01-01
tags:
  - test
---

This body is intentionally identical to the other card so the duplicate check can catch it.
""",
            encoding="utf-8",
        )
        with patch.object(governance, "VAULT", vault):
            governance.scan()

        archived = list((vault / "90-archive").rglob("*.md"))
        self.assertTrue(archived, "重复卡没有被归档")


if __name__ == "__main__":
    unittest.main()
