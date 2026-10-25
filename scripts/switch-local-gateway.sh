#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GATEWAY="$ROOT/apps/gateway"
UID_NUM="$(id -u)"
LABEL_DAILY="com.kenz1117.oakb.daily"
LABEL_INGEST="com.kenz1117.oakb.auto-ingest"
PLIST_DAILY="$HOME/Library/LaunchAgents/$LABEL_DAILY.plist"
PLIST_INGEST="$HOME/Library/LaunchAgents/$LABEL_INGEST.plist"

for label in "$LABEL_DAILY" "$LABEL_INGEST"; do
  launchctl bootout "gui/$UID_NUM/$label" >/dev/null 2>&1 || true
done

cat > "$PLIST_DAILY" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL_DAILY</string>
  <key>ProgramArguments</key><array><string>$GATEWAY/bin/oakb-daily-sync</string></array>
  <key>WorkingDirectory</key><string>$GATEWAY</string>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>$GATEWAY/runtime/logs/launchd.out</string>
  <key>StandardErrorPath</key><string>$GATEWAY/runtime/logs/launchd.err</string>
</dict>
</plist>
PLIST

cat > "$PLIST_INGEST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL_INGEST</string>
  <key>ProgramArguments</key><array><string>$GATEWAY/bin/oakb-auto-ingest</string></array>
  <key>WorkingDirectory</key><string>$GATEWAY</string>
  <key>StartInterval</key><integer>3600</integer>
  <key>StandardOutPath</key><string>$GATEWAY/runtime/logs/auto-ingest-launchd.out</string>
  <key>StandardErrorPath</key><string>$GATEWAY/runtime/logs/auto-ingest-launchd.err</string>
</dict>
</plist>
PLIST

plutil -lint "$PLIST_DAILY" "$PLIST_INGEST"
launchctl bootstrap "gui/$UID_NUM" "$PLIST_DAILY"
launchctl bootstrap "gui/$UID_NUM" "$PLIST_INGEST"
launchctl enable "gui/$UID_NUM/$LABEL_DAILY"
launchctl enable "gui/$UID_NUM/$LABEL_INGEST"
printf 'Switched local scheduled jobs to %s\n' "$GATEWAY"
