#!/bin/bash
# Renders the narration for help videos with the macOS voice Ava (Premium).
#
#   docs/training-videos/render-narration.sh            every script
#   docs/training-videos/render-narration.sh B2 C4      only these video ids
#
# Reads docs/training-videos/scripts/<ID>-*.txt. Only the lines that start with [SAY] are spoken;
# [SCREEN] lines are directions for whoever records the screen. A short pause is added between
# [SAY] lines. Output: docs/training-videos/audio/<ID>.m4a (not committed).
#
# Settings (override on the command line, e.g.  RATE=165 docs/training-videos/render-narration.sh):
#   RATE   words per minute, default 160 (we agreed on 160 to 165 so it never sounds rushed)
#   PAUSE  milliseconds of silence between [SAY] lines, default 700
#   VOICE  default "Ava (Premium)"
set -euo pipefail
cd "$(dirname "$0")"
VOICE="${VOICE:-Ava (Premium)}"
RATE="${RATE:-160}"
PAUSE="${PAUSE:-700}"
mkdir -p audio
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

if [ "$#" -gt 0 ]; then ids=("$@"); else ids=($(ls scripts | sed -E 's/^([A-Z][0-9]+)-.*/\1/' | sort -u)); fi

printf '%-5s %6s %9s  %s\n' ID WORDS DURATION FILE
for id in "${ids[@]}"; do
  src="$(ls scripts/"$id"-*.txt 2>/dev/null | head -1 || true)"
  if [ -z "$src" ]; then echo "$id: no script found" >&2; continue; fi
  grep '^\[SAY\]' "$src" | sed -E 's/^\[SAY\] ?//' | awk -v p="$PAUSE" 'NR>1{print "[[slnc " p "]]"} {print}' > "$tmp"
  words=$(grep '^\[SAY\]' "$src" | sed -E 's/^\[SAY\] ?//' | wc -w | tr -d ' ')
  say -v "$VOICE" -r "$RATE" --file-format=m4af --data-format=aac -f "$tmp" -o "audio/$id.m4a"
  secs=$(afinfo "audio/$id.m4a" | awk '/estimated duration/{print $3}')
  printf '%-5s %6s %8.0fs  %s\n' "$id" "$words" "$secs" "audio/$id.m4a"
done
