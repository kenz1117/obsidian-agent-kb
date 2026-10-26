from pathlib import Path

import pytest

from oakb_gateway import governance


def test_find_object_rejects_paths_outside_vault(tmp_path, monkeypatch):
    vault = tmp_path / "vault"
    vault.mkdir()
    outside = tmp_path / "outside.md"
    outside.write_text("---\nstatus: canonical\n---\n", encoding="utf-8")
    monkeypatch.setattr(governance, "VAULT", vault)
    with pytest.raises(FileNotFoundError):
        governance._find_object(str(outside))
    with pytest.raises(FileNotFoundError):
        governance._find_object("03-knowledge/../../outside.md")


def test_governed_files_skip_symlinks(tmp_path, monkeypatch):
    vault = tmp_path / "vault"
    governed = vault / "03-knowledge" / "auto"
    governed.mkdir(parents=True)
    outside = tmp_path / "outside.md"
    outside.write_text("outside", encoding="utf-8")
    link = governed / "link.md"
    try:
        link.symlink_to(outside)
    except OSError:
        pytest.skip("symlinks unavailable")
    monkeypatch.setattr(governance, "VAULT", vault)
    assert governance._governed_files() == []


def test_promote_rejects_archived_objects(tmp_path, monkeypatch):
    vault = tmp_path / "vault"
    archive = vault / "90-archive" / "governance"
    archive.mkdir(parents=True)
    card = archive / "card.md"
    card.write_text("""---
id: card
type: knowledge
title: Card
status: canonical
source: agent://test
confidence: high
governance_score: 100
sensitivity: internal
---

Decision: use a governed archive boundary.
""", encoding="utf-8")
    monkeypatch.setattr(governance, "VAULT", vault)
    with pytest.raises(PermissionError, match="archived"):
        governance.promote("90-archive/governance/card.md")
