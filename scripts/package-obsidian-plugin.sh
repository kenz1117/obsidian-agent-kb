#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLUGIN="$ROOT/packages/obsidian-plugin"
VERSION="$(node -p "require('$PLUGIN/manifest.json').version")"
PACKAGE_VERSION="$(node -p "require('$PLUGIN/package.json').version")"
if [[ "$VERSION" != "$PACKAGE_VERSION" ]]; then
  printf 'Version mismatch: manifest=%s package=%s\n' "$VERSION" "$PACKAGE_VERSION" >&2
  exit 1
fi
for REQUIRED in service-node service-node.LICENSE; do
  if [[ ! -f "$PLUGIN/$REQUIRED" ]]; then
    printf 'Missing %s. Run scripts/fetch-obsidian-service-runtime.sh first.\n' "$REQUIRED" >&2
    exit 1
  fi
done
pnpm --dir "$ROOT" --filter @oakb/obsidian-plugin build
STAGE="$ROOT/dist/obsidian-agent-kb"
ARCHIVE="$ROOT/dist/obsidian-agent-kb-$VERSION.zip"
rm -rf "$STAGE" "$ARCHIVE"
mkdir -p "$STAGE"
cp "$PLUGIN/manifest.json" "$PLUGIN/main.js" "$PLUGIN/service.js" "$PLUGIN/service-node" "$PLUGIN/service-node.LICENSE" "$PLUGIN/styles.css" "$STAGE/"
(cd "$ROOT/dist" && zip -q -r "$(basename "$ARCHIVE")" obsidian-agent-kb)
printf 'Created %s\n' "$ARCHIVE"
