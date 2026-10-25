import unittest
from oakb_gateway.governance import parse_frontmatter

class TestFrontmatter(unittest.TestCase):
    def test_parse(self):
        parsed = parse_frontmatter("""---
id: kb-1
title: Example
status: auto
tags:
  - ai
  - governance
---

Body
""")
        self.assertTrue(parsed[2])
        self.assertEqual(parsed[0]["id"], "kb-1")
        self.assertEqual(parsed[0]["tags"], ["ai", "governance"])
        self.assertIn("Body", parsed[1])

if __name__ == "__main__":
    unittest.main()
