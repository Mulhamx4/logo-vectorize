#!/usr/bin/env bash
# Installs the tracing + export toolchain. Safe to re-run.
set -e
if ! command -v potrace >/dev/null 2>&1; then
  (apt-get install -y potrace >/dev/null 2>&1) || (apt-get update >/dev/null 2>&1 && apt-get install -y potrace >/dev/null 2>&1) \
    || { echo "potrace install failed (try: sudo apt-get install potrace / brew install potrace)"; exit 1; }
fi
python3 - <<'PY' || pip install --break-system-packages -q cairosvg opencv-python-headless pillow numpy 2>/dev/null || pip install -q cairosvg opencv-python-headless pillow numpy
import cairosvg, cv2, PIL, numpy
PY
echo "ready: $(potrace --version | head -1)"
