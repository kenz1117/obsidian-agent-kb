#!/usr/bin/env python3
"""校验派生物卡片的引用是否逐字存在于其来源材料中。

规则来自 05-decisions/ADR-007-derived-knowledge-role.md 第 4、5 条：
每条实质性断言必须挂引用，且引文必须能在输入材料中字符串命中。

支持两类派生物：
- distill_method: extraction —— 来源是 06-sources/ 下的源文档
- distill_method: synthesis   —— 来源是 03-knowledge/ 下的正式知识卡

用法：
    python3 verify_source_citations.py [目录 ...]
"""
import pathlib
import re
import sys

VAULT = pathlib.Path("/Users/ken/Documents/Knowledge")
CITE = re.compile(r"（源：([^「」]+)「([^」]+)」）")
FRONTMATTER = re.compile(r"^---\n(.*?)\n---", re.S)
KNOWLEDGE_DIRS = ("03-knowledge/canonical", "03-knowledge/reviewed", "03-knowledge/auto")


def load_frontmatter(text: str) -> dict:
    match = FRONTMATTER.match(text)
    if not match:
        return {}
    fields = {}
    for line in match.group(1).splitlines():
        if ":" in line and not line.startswith((" ", "-", "\t")):
            key, _, value = line.partition(":")
            fields[key.strip()] = value.strip().strip('"').strip("'")
    return fields


def build_index() -> dict[str, str]:
    """把 Vault 里可被引用的材料建成 label -> 正文 的索引。"""
    index: dict[str, str] = {}
    for path in VAULT.rglob("*.md"):
        if ".obsidian" in path.parts or ".git" in path.parts:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        rel = path.relative_to(VAULT).as_posix()
        index[path.stem] = text
        index[path.name] = text
        index[rel] = text
    return index


def resolve(label: str, card_source: str, index: dict[str, str]) -> tuple[str, str]:
    """按候选顺序解析引用目标，返回 (解析到的内容, 命中来源说明)。"""
    candidates = [label, label.removesuffix(".md"), f"{label}.md"]
    for key in candidates:
        if key in index:
            return index[key], key
    if card_source and card_source in index:
        return index[card_source], card_source
    return "", ""


def main() -> int:
    targets = [pathlib.Path(a) for a in sys.argv[1:]] or [VAULT / "03-knowledge/auto"]
    index = build_index()

    total = 0
    failures: list[tuple[str, str, str, str]] = []
    cards_checked = 0
    per_card: list[tuple[str, int]] = []

    for target in targets:
        cards = sorted(p for p in target.glob("*.md") if p.name != ".gitkeep")
        for card in cards:
            text = card.read_text(encoding="utf-8")
            fm = load_frontmatter(text)
            card_source = fm.get("source_ref") or fm.get("source") or ""
            hits = 0
            for cited, fragment in CITE.findall(text):
                total += 1
                body, resolved = resolve(cited, card_source, index)
                if not body:
                    failures.append((card.name, cited, fragment, "引用目标无法解析"))
                elif fragment in body:
                    hits += 1
                else:
                    failures.append((card.name, cited, fragment, f"引文未命中（目标 {resolved}）"))
            if CITE.search(text):
                cards_checked += 1
                per_card.append((card.name, hits))

    print(f"校验目录：{', '.join(str(t) for t in targets)}")
    print(f"含引用的卡片 {cards_checked} 张，引用 {total} 条")
    if per_card:
        print("\n逐卡命中：")
        for name, hits in per_card:
            print(f"  {hits:>3} 条命中   {name}")
    if failures:
        print(f"\n未通过 {len(failures)} 条：")
        for name, cited, fragment, why in failures:
            print(f"  FAIL [{why}] {name}")
            print(f"        标称来源：{cited}")
            print(f"        引文：「{fragment[:70]}」")
        return 1
    print("\n全部引文均能在来源材料中逐字命中。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
