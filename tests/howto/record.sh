#!/bin/bash
# Records how-to videos from a fresh test site each time (so every video starts from the same data):
#   tests/howto/record.sh B1 B2 A1      records those, one after another
# Output: tests/howto-out/<ID>/<ID>.mp4 (+ .vtt captions and -poster.jpg). Needs Docker running.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
for id in "$@"; do
  echo "=== $id: fresh test site"
  "$HERE/stack.sh" up > /dev/null 2>&1 || { echo "stack failed"; exit 1; }
  echo "=== $id: recording"
  (cd "$HERE/.." && npm run howto --silent -- "$id") 2>&1 | tail -6 || echo "$id FAILED"
done
