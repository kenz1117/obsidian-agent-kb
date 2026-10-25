#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VAULT="${1:?Usage: install-obsidian-plugin.sh /path/to/vault}"
DEST="$VAULT/.obsidian/plugins/obsidian-agent-kb"
mkdir -p "$DEST"
cp "$ROOT/packages/obsidian-plugin/manifest.json" "$DEST/"
cp "$ROOT/packages/obsidian-plugin/main.js" "$DEST/"
cp "$ROOT/packages/obsidian-plugin/styles.css" "$DEST/"
printf 'Installed Obsidian Agent KB plugin to: %s\n' "$DEST"
