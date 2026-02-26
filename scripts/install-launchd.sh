#!/usr/bin/env bash
# Installs a LaunchAgent to run the Slack profile rotator at login.
# Uses a wrapper script that loads .env and runs node.

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NODE="$(command -v node)"
PLIST="$HOME/Library/LaunchAgents/com.slack.profile-rotator.plist"
WRAPPER="$PROJECT_ROOT/scripts/run-with-env.sh"

# Create wrapper that loads .env and runs start
mkdir -p "$(dirname "$WRAPPER")"
cat > "$WRAPPER" << EOF
#!/usr/bin/env bash
cd "$PROJECT_ROOT"
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi
exec "$NODE" src/index.js start
EOF
chmod +x "$WRAPPER"

cat > "$PLIST" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.slack.profile-rotator</string>
  <key>ProgramArguments</key>
  <array>
    <string>$WRAPPER</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$PROJECT_ROOT</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>$PROJECT_ROOT/rotator.log</string>
  <key>StandardErrorPath</key>
  <string>$PROJECT_ROOT/rotator.err</string>
</dict>
</plist>
EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "Installed. Rotator will start at login. Logs: $PROJECT_ROOT/rotator.log"
echo "To stop: launchctl unload $PLIST"
