#!/bin/bash
# Sets up a Claude Code cloud session so the tests and checks run: npm packages, ffmpeg (clip tools tests), and a Chromium
# launcher for the browser tests (they read the CHROME environment variable). Only runs in cloud sessions; safe to run again.
set -euo pipefail
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then exit 0; fi
cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

# npm install (not ci) so the container's cached node_modules is reused
npm install --no-audit --no-fund --loglevel=error

# ffmpeg and ffprobe are used by tools/check-clips.mjs and its test
if ! command -v ffmpeg >/dev/null 2>&1; then
  (apt-get install -y -qq ffmpeg >/dev/null 2>&1 || (apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq ffmpeg >/dev/null 2>&1)) || echo "session-start: could not install ffmpeg; tests/clip-tools.test.mjs will be skipped" >&2
fi

# The browser tests need Chromium started with --no-sandbox when running as root
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export CHROME=\"$PWD/.claude/hooks/chrome-no-sandbox.sh\"" >> "$CLAUDE_ENV_FILE"
fi
