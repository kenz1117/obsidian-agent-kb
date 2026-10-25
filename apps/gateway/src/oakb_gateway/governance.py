from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

APP_ROOT = Path(__file__).resolve().parents[2]
POLICY_PATH = APP_ROOT / "config" / "governance.policy.json"
VAULT = Path(os.environ.get("KB_VAULT_ROOT", "~/Documents/Knowledge")).expanduser().resolve()

SECRET_PATTERNS = [
    re.compile(r"-----BEGIN (?:RSA |OPENSSH |EC |DSA |PGP )?PRIVATE KEY-----"),
    re.compile(r"(?i)\b(?:api[_-]?key|secret|token|password|passwd|pwd)\b\s*[:=]\s*['\"]?[A-Za-z0-9_\-]{16,}"),
    re.compile(r"(?i)\b(?:mysql|postgres|postgresql|mongodb(?:\+srv)?|redis)://[^\s/:]+:[^\s@]+@"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bsk-[A-Za-z0-9]{20,}\b"),
]

ACTIONABLE = re.compile(
    r"\b(decide|decision|use|prefer|avoid|because|constraint|require|method|steps?|risk|rule|migration|configuration)\b",
    re.I,
)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def today() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def load_policy() -> dict[str, Any]:
    return json.loads(POLICY_PATH.read_text(encoding="utf-8"))


def parse_frontmatter(text: str) -> tuple[dict[str, Any], str, bool]:
    match = re.match(r"^---\n(.*?)\n---\n?", text, re.S)
    if not match:
        return {}, text, False
    data: dict[str, Any] = {}
    key = None
    values: list[str] | None = None
    for raw in match.group(1).splitlines():
        line = raw.rstrip()
        if not line or line.lstrip().startswith("#"):
            continue
        item = re.match(r"^\s+-\s+(.*)$", line)
        if item and key and isinstance(data.get(key), list):
            data[key].append(_scalar(item.group(1)))
            continue
        pair = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", line)
        if not pair:
            continue
        key = pair.group(1)
        value = pair.group(2).strip()
        if value == "":
            values = []
            data[key] = values
        elif value.startswith("[") and value.endswith("]"):
            inner = value[1:-1].strip()
            data[key] = [] if not inner else [_scalar(x.strip()) for x in inner.split(",")]
            values = None
        else:
            data[key] = _scalar(value)
            values = None
    return data, text[match.end():], True


def _scalar(value: str) -> Any:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    if value.lower() in {"true", "false"}:
        return value.lower() == "true"
    if value.lower() in {"null", "~"}:
        return None
    if re.fullmatch(r"[+-]?\d+", value or ""):
        return int(value)
    return value


def stringify_frontmatter(data: dict[str, Any]) -> str:
    lines = ["---"]
    for key, value in data.items():
        if isinstance(value, list):
            if not value:
                lines.append(f"{key}: []")
            else:
                lines.append(f"{key}:")
                lines.extend(f"  - {_scalar_output(item)}" for item in value)
        else:
            lines.append(f"{key}: {_scalar_output(value)}")
    lines.extend(["---", ""])
    return "\n".join(lines)


def _scalar_output(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    text = str(value)
    if text == "":
        return '""'
    if re.fullmatch(r"[\w./@:+ -]+", text) and not text.strip() != text:
        return text
    return json.dumps(text, ensure_ascii=False)


def write_frontmatter(path: Path, data: dict[str, Any], body: str) -> None:
    path.write_text(stringify_frontmatter(data) + body.lstrip("\r\n"), encoding="utf-8")


def normalized_title(value: str) -> str:
    return re.sub(r"[^\w]+", "", value.lower(), flags=re.UNICODE)


def body_fingerprint(body: str) -> str:
    compact = re.sub(r"\s+", " ", re.sub(r"^#.*$|^>.*$", "", body, flags=re.M)).strip().lower()
    return hashlib.sha256(compact.encode("utf-8")).hexdigest()


def title_similarity(left: str, right: str) -> float:
    a, b = normalized_title(left), normalized_title(right)
    return 1.0 if a == b else SequenceMatcher(None, a, b).ratio()


def detect_secrets(text: str) -> list[str]:
    return [p.pattern for p in SECRET_PATTERNS if p.search(text)]


@dataclass
class Candidate:
    path: Path
    relative_path: str
    metadata: dict[str, Any]
    body: str
    score: int = 0
    decision: str = "review"
    route: str = "review"
    reasons: list[str] | None = None
    violations: list[str] | None = None
    duplicate_of: str | None = None

    def __post_init__(self) -> None:
        self.reasons = self.reasons or []
        self.violations = self.violations or []


def _governed_files() -> list[Path]:
    roots = [VAULT / "03-knowledge" / x for x in ("auto", "reviewed", "canonical")]
    files: list[Path] = []
    for root in roots:
        if root.exists():
            files.extend(path for path in root.rglob("*.md") if path.is_file())
    return sorted(set(files))


def score_card(metadata: dict[str, Any], body: str) -> tuple[int, list[str]]:
    reasons: list[str] = []
    provenance = 20 if metadata.get("source") else 0
    if provenance == 0:
        reasons.append("missing provenance/source")

    actionable = bool(ACTIONABLE.search(body))
    actionability = 20 if actionable else min(15, len(body) // 50)
    if actionability == 0:
        reasons.append("not actionable")

    specificity = 10 if len(body) > 700 else 7 if len(body) > 250 else 4 if len(body) > 70 else 0
    if specificity == 0:
        reasons.append("too short or vague")

    headings = len(re.findall(r"^##\s+", body, re.M))
    specificity = min(10, specificity + (1 if headings else 0))

    evidence = 15 if metadata.get("source") and metadata.get("source") != "unknown" else 0
    if evidence == 0:
        reasons.append("missing evidence/source")

    freshness = 10
    updated = str(metadata.get("updated") or "")
    try:
        age_days = max(0, (datetime.now() - datetime.fromisoformat(updated.replace("Z", "+00:00")).replace(tzinfo=None)).days)
        freshness = max(0, 10 - age_days // 90 * 2)
    except ValueError:
        freshness = 0
        reasons.append("missing or invalid updated date")

    safety = 0 if detect_secrets(body) else 10
    if safety == 0:
        reasons.append("potential secret detected")

    score = provenance + actionability + 15 + evidence + freshness + specificity + safety
    return max(0, min(100, score)), reasons


def route_card(path: Path, metadata: dict[str, Any], body: str, policy: dict[str, Any]) -> tuple[int, str, str, list[str], list[str]]:
    violations: list[str] = []
    reasons: list[str] = []

    for field in policy["required_fields"]:
        if metadata.get(field) in (None, "", []):
            violations.append(f"missing field: {field}")

    if metadata.get("type") not in policy["allowed_types"]:
        violations.append(f"invalid type: {metadata.get('type')}")

    secrets = detect_secrets(body)
    if secrets:
        violations.append("potential secret detected")
    sensitivity = str(metadata.get("sensitivity") or policy["sensitivity"]["default"])
    if sensitivity in policy["sensitivity"]["reject"]:
        violations.append(f"sensitivity rejected: {sensitivity}")

    score, score_reasons = score_card(metadata, body)
    reasons.extend(score_reasons)

    if violations:
        return score, "reject", "archive", reasons, violations
    if score < policy["quality"]["reject_below"]:
        return score, "archive", "archive", reasons, violations
    if score < policy["quality"]["min_review"]:
        return score, "temporary", "auto", reasons, violations
    if score < policy["quality"]["min_canonical"] or sensitivity in policy["sensitivity"]["require_review"]:
        return score, "review", "reviewed", reasons, violations
    return score, "canonical_review", "reviewed", reasons, violations


def _unique_destination(destination: Path) -> Path:
    if not destination.exists():
        return destination
    stem, suffix = destination.stem, destination.suffix
    for number in range(1, 1000):
        candidate = destination.with_name(f"{stem}-{number}{suffix}")
        if not candidate.exists():
            return candidate
    raise FileExistsError(destination)


def _archive(path: Path, category: str, relative_path: str) -> str:
    destination = VAULT / "90-archive" / "governance" / category / relative_path.removeprefix("03-knowledge/")
    destination = _unique_destination(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(path), str(destination))
    return destination.relative_to(VAULT).as_posix()


def _upsert_map(path: Path, section: str, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    current = path.read_text(encoding="utf-8") if path.exists() else ""
    marker = f"<!-- {section} -->"
    if marker in current:
        pattern = re.compile(re.escape(marker) + r"\n.*?(?=\n<!-- |\Z)", re.S)
        current = pattern.sub(marker + "\n" + content, current)
    else:
        current = current.rstrip() + f"\n\n{marker}\n{content}\n"
    path.write_text(current, encoding="utf-8")


def scan() -> dict[str, Any]:
    policy = load_policy()
    candidates: list[Candidate] = []
    for path in _governed_files():
        rel = path.relative_to(VAULT).as_posix()
        text = path.read_text(encoding="utf-8")
        metadata, body, has_fm = parse_frontmatter(text)
        if not has_fm:
            metadata = {"id": path.stem, "type": "knowledge", "title": path.stem, "status": "auto"}
            body = text
        metadata.setdefault("sensitivity", policy["sensitivity"]["default"])
        metadata.setdefault("origin", str(metadata.get("agent") or "importer"))
        score, decision, route, reasons, violations = route_card(path, metadata, body, policy)
        candidates.append(Candidate(path, rel, metadata, body, score, decision, route, reasons, violations))

    # Exact body duplicates, then normalized-title duplicates.
    by_body: dict[str, list[Candidate]] = {}
    for candidate in candidates:
        by_body.setdefault(body_fingerprint(candidate.body), []).append(candidate)
    for group in by_body.values():
        if len(group) < 2:
            continue
        group.sort(key=lambda c: (-c.score, str(c.path)))
        for duplicate in group[1:]:
            duplicate.decision = "reject"
            duplicate.route = "archive"
            duplicate.duplicate_of = group[0].relative_path
            duplicate.violations.append(f"exact duplicate of {duplicate.duplicate_of}")

    by_title: dict[str, list[Candidate]] = {}
    for candidate in candidates:
        if candidate.decision == "reject":
            continue
        title = normalized_title(str(candidate.metadata.get("title") or candidate.path.stem))
        by_title.setdefault(title, []).append(candidate)
    threshold = float(policy["duplicate"]["normalized_title_similarity"])
    for group in by_title.values():
        if len(group) < 2:
            continue
        for index, candidate in enumerate(group):
            if candidate.decision == "reject":
                continue
            for other in group[index + 1:]:
                if other.decision == "reject":
                    continue
                similarity = title_similarity(str(candidate.metadata.get("title")), str(other.metadata.get("title")))
                if similarity >= threshold:
                    loser = candidate if candidate.score < other.score else other
                    winner = other if loser is candidate else candidate
                    loser.decision = "reject"
                    loser.route = "archive"
                    loser.duplicate_of = winner.relative_path
                    loser.violations.append(f"near duplicate of {winner.relative_path} ({similarity:.2f})")

    moved: list[dict[str, Any]] = []
    for candidate in candidates:
        original_rel = candidate.relative_path
        metadata = candidate.metadata
        metadata["governance_score"] = candidate.score
        metadata["governance_decision"] = candidate.decision
        metadata["governance_reviewed_at"] = now_iso()
        metadata["governance_review_by"] = "governance-engine"
        if candidate.duplicate_of:
            metadata["duplicate_of"] = candidate.duplicate_of
        if candidate.violations:
            metadata["governance_issues"] = candidate.violations

        target_rel = original_rel
        if candidate.route == "archive":
            target_rel = _archive(candidate.path, candidate.decision, original_rel)
            metadata["status"] = "archive"
        elif candidate.route == "reviewed" and not original_rel.startswith("03-knowledge/reviewed/"):
            destination = VAULT / "03-knowledge" / "reviewed" / candidate.path.name
            destination = _unique_destination(destination)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(candidate.path), str(destination))
            target_rel = destination.relative_to(VAULT).as_posix()
            metadata["status"] = "review"
        elif candidate.route == "auto":
            metadata["status"] = "temporary"

        if candidate.path.exists():
            write_frontmatter(candidate.path, metadata, candidate.body)
        elif VAULT / target_rel != candidate.path:
            target_path = VAULT / target_rel
            write_frontmatter(target_path, metadata, candidate.body)

        moved.append({
            "path": target_rel,
            "previous_path": original_rel,
            "score": candidate.score,
            "decision": candidate.decision,
            "route": candidate.route,
            "duplicate_of": candidate.duplicate_of,
            "violations": candidate.violations,
            "reasons": candidate.reasons,
        })

    review_items = [item for item in moved if item["route"] == "reviewed"]
    archive_items = [item for item in moved if item["route"] == "archive"]
    review_content = "\n".join(
        f"- [{item['path']}] score `{item['score']}` decision `{item['decision']}`"
        for item in sorted(review_items, key=lambda x: (-x["score"], x["path"]))
    ) or "No cards currently require review."
    archive_content = "\n".join(
        f"- `{item['previous_path']}` → `{item['path']}` — `{item['decision']}`"
        for item in archive_items
    ) or "No cards were archived in the last scan."

    review_map = VAULT / "07-maps" / "GOVERNANCE-REVIEW.md"
    status_map = VAULT / "07-maps" / "GOVERNANCE-STATUS.md"
    if not review_map.exists():
        review_map.write_text(
            "---\nid: governance-review\ntype: map\nstatus: generated\ntags:\n  - governance\n  - review\n---\n\n# Governance Review\n",
            encoding="utf-8",
        )
    if not status_map.exists():
        status_map.write_text(
            "---\nid: governance-status\ntype: map\nstatus: generated\ntags:\n  - governance\n  - status\n---\n\n# Governance Status\n",
            encoding="utf-8",
        )
    _upsert_map(review_map, "review queue", review_content)
    _upsert_map(status_map, "last scan", f"- Generated: `{now_iso()}`\n- Scanned: `{len(candidates)}`\n- Review: `{len(review_items)}`\n- Archived: `{len(archive_items)}`")

    audit_path = APP_ROOT / "runtime" / "governance.jsonl"
    audit_path.parent.mkdir(parents=True, exist_ok=True)
    with audit_path.open("a", encoding="utf-8") as output:
        for item in moved:
            output.write(json.dumps({"timestamp": now_iso(), "event": "governance.scan", **item}, ensure_ascii=False, separators=(",", ":")) + "\n")

    return {
        "generated_at": now_iso(),
        "scanned": len(candidates),
        "review": len(review_items),
        "archived": len(archive_items),
        "temporary": sum(1 for item in moved if item["route"] == "auto"),
        "moved": moved,
        "review_map": review_map.relative_to(VAULT).as_posix(),
        "status_map": status_map.relative_to(VAULT).as_posix(),
    }


def _find_object(target: str) -> Path:
    if Path(target).is_absolute() or target.startswith("03-knowledge/") or target.startswith("90-archive/"):
        candidate = VAULT / target
        if candidate.exists():
            return candidate.resolve()
    for root in ("reviewed", "auto", "canonical"):
        candidate = VAULT / "03-knowledge" / root / target
        if candidate.exists():
            return candidate.resolve()
    for path in _governed_files():
        text = path.read_text(encoding="utf-8")
        metadata, _, _ = parse_frontmatter(text)
        if metadata.get("id") == target:
            return path
    raise FileNotFoundError(f"knowledge object not found: {target}")


def promote(target: str, reviewer: str = "human") -> dict[str, Any]:
    policy = load_policy()
    source = _find_object(target)
    text = source.read_text(encoding="utf-8")
    metadata, body, _ = parse_frontmatter(text)
    score = int(metadata.get("governance_score") or 0)
    reasons: list[str] = []

    if metadata.get("status") != policy["promotion"]["require_status"] and metadata.get("status") != "canonical":
        reasons.append(f"status must be review, got {metadata.get('status')}")
    if score < policy["promotion"]["min_score"]:
        reasons.append(f"governance score below {policy['promotion']['min_score']}")
    if metadata.get("confidence") not in policy["promotion"]["allowed_confidence"]:
        reasons.append("confidence too low")
    if metadata.get("sensitivity") in policy["promotion"]["forbidden_sensitivity"]:
        reasons.append("sensitivity forbidden")
    if detect_secrets(body):
        reasons.append("potential secret detected")

    if metadata.get("status") == "canonical":
        destination = source
    elif reasons:
        raise PermissionError("; ".join(reasons))
    else:
        destination = _unique_destination(VAULT / "03-knowledge" / "canonical" / source.name)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(source), str(destination))
        source = destination

    metadata["status"] = "canonical"
    metadata["reviewed_at"] = now_iso()
    metadata["review_by"] = reviewer
    write_frontmatter(source, metadata, body)

    result = {"promoted": True, "path": source.relative_to(VAULT).as_posix(), "score": score, "reviewer": reviewer}
    audit_path = APP_ROOT / "runtime" / "governance.jsonl"
    audit_path.parent.mkdir(parents=True, exist_ok=True)
    with audit_path.open("a", encoding="utf-8") as output:
        output.write(json.dumps({"timestamp": now_iso(), "event": "knowledge.promoted", **result}, ensure_ascii=False, separators=(",", ":")) + "\n")
    return result


def archive(target: str, reason: str = "manual governance decision") -> dict[str, Any]:
    source = _find_object(target)
    text = source.read_text(encoding="utf-8")
    metadata, body, _ = parse_frontmatter(text)
    relative = source.relative_to(VAULT).as_posix()
    destination = _archive(source, "manual", relative)
    metadata["status"] = "archive"
    metadata["archive_reason"] = reason
    metadata["archived_at"] = now_iso()
    write_frontmatter(VAULT / destination, metadata, body)
    result = {"archived": True, "previous_path": relative, "path": destination, "reason": reason}
    audit_path = APP_ROOT / "runtime" / "governance.jsonl"
    with audit_path.open("a", encoding="utf-8") as output:
        output.write(json.dumps({"timestamp": now_iso(), "event": "knowledge.archived", **result}, ensure_ascii=False, separators=(",", ":")) + "\n")
    return result


def doctor() -> dict[str, Any]:
    policy = load_policy()
    issues: list[str] = []
    required_dirs = [
        VAULT / "03-knowledge" / x for x in ("auto", "reviewed", "canonical")
    ] + [VAULT / "90-archive", VAULT / "07-maps"]
    for path in required_dirs:
        if not path.exists():
            issues.append(f"missing directory: {path}")
    if not POLICY_PATH.exists():
        issues.append(f"missing policy: {POLICY_PATH}")

    counts = {name: len(list((VAULT / "03-knowledge" / name).rglob("*.md"))) for name in ("auto", "reviewed", "canonical")}
    secret_files: list[str] = []
    for path in _governed_files():
        text = path.read_text(encoding="utf-8")
        if detect_secrets(text):
            secret_files.append(path.relative_to(VAULT).as_posix())
    if secret_files:
        issues.append(f"secret-bearing files: {', '.join(secret_files)}")

    return {
        "ok": not issues,
        "vault": str(VAULT),
        "policy_version": policy.get("version"),
        "counts": counts,
        "issues": issues,
    }
