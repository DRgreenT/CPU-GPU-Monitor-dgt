#!/usr/bin/env bash
set -euo pipefail
BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPLET_DIR="$HOME/.local/share/cinnamon/applets/CPU-GPU-Monitor@dgt"
mkdir -p "$APPLET_DIR"
cp "$BASE/files/CPU-GPU-Monitor@dgt/metadata.json" "$APPLET_DIR/"
cp "$BASE/files/CPU-GPU-Monitor@dgt/applet.js" "$APPLET_DIR/"
sudo install -D -m 0755 "$BASE/service/loq-rapl-monitor.py" /usr/local/libexec/loq-rapl-monitor.py
sudo install -D -m 0644 "$BASE/service/loq-rapl-monitor.service" /etc/systemd/system/loq-rapl-monitor.service
sudo systemctl daemon-reload
sudo systemctl enable --now loq-rapl-monitor.service
echo "Installed. Add 'CPU/GPU Monitor' through Cinnamon applets settings."
echo "Service: systemctl status loq-rapl-monitor --no-pager"
