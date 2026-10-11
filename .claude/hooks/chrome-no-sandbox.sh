#!/bin/sh
# Starts the Chromium that comes with the cloud container with --no-sandbox (needed as root). Used through the CHROME variable.
for c in /opt/pw-browsers/chromium /opt/pw-browsers/chromium-*/chrome-linux/chrome /usr/bin/chromium /usr/bin/chromium-browser /usr/bin/google-chrome; do
  if [ -x "$c" ]; then exec "$c" --no-sandbox "$@"; fi
done
echo "no Chromium found" >&2; exit 127
