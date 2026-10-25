#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLUGIN="$ROOT/packages/obsidian-plugin"
VERSION="24.20.0"
PLATFORM="darwin-arm64"
DIST="node-v$VERSION-$PLATFORM"
ARCHIVE="$DIST.tar.xz"
URL="https://nodejs.org/dist/v$VERSION/$ARCHIVE"
SHA256="b7bf7707070b950ba1ec5f1af3bb6de0f2b1962c5033973d94068ab021ef3014"
TEMP="$(mktemp -d "${TMPDIR:-/tmp}/oakb-service-runtime.XXXXXX")"
trap 'rm -rf "$TEMP"' EXIT

curl --fail --location --retry 3 --retry-all-errors --retry-delay 2 --connect-timeout 20 --output "$TEMP/$ARCHIVE" "$URL"
if command -v shasum >/dev/null 2>&1; then
  printf '%s  %s\n' "$SHA256" "$TEMP/$ARCHIVE" | shasum -a 256 -c -
else
  printf '%s  %s\n' "$SHA256" "$TEMP/$ARCHIVE" | sha256sum -c -
fi

tar -xJf "$TEMP/$ARCHIVE" -C "$TEMP"
install -m 755 "$TEMP/$DIST/bin/node" "$PLUGIN/service-node"
install -m 644 "$TEMP/$DIST/LICENSE" "$PLUGIN/service-node.LICENSE"
printf 'Installed verified Node %s (%s) runtime.\n' "$VERSION" "$PLATFORM"
