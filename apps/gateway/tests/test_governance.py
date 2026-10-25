import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from oakb_gateway import governance


class TestGovernance(unittest.TestCase):
    def make_vault(self):
        root = Path(tempfile.mkdtemp(prefix="oakb-vault-"))
        (root / "03-knowledge/auto").mkdir(parents=True)
        (root / "07-maps").mkdir()
        return root

    def make_card(self, root: Path, name: str, title: str, body: str):
        path = root / "03-knowledge/auto" / name
        path.write_text(f"""---
id: {path.stem}
type: knowledge
title: "{title}"
status: auto
source: 06-sources/example.md
confidence: high
created: 2026-01-01
updated: 2026-01-01
tags:
  - test
---

{body}
""", encoding="utf-8")
        return path

    def test_scan_routes_good_card_to_review(self):
        vault = self.make_vault()
        self.make_card(
            vault,
            "good.md",
            "Use SQLite for metadata",
            "Decision: use SQLite because metadata requires transactional local updates. Configure the database path and migrate records during startup.",
        )
        with patch.object(governance, "VAULT", vault):
            result = governance.scan()
        self.assertEqual(result["scanned"], 1)
        self.assertTrue((vault / "03-knowledge/reviewed/good.md").exists())

    def test_scan_archives_exact_duplicate(self):
        vault = self.make_vault()
        body = "Decision: use PostgreSQL for shared metadata because multiple agents require transactional consistency and centralized backups."
        self.make_card(vault, "one.md", "Use PostgreSQL for metadata", body)
        self.make_card(vault, "two.md", "Use PostgreSQL for metadata", body)
        with patch.object(governance, "VAULT", vault):
            result = governance.scan()
        self.assertGreaterEqual(result["archived"], 1)


if __name__ == "__main__":
    unittest.main()
