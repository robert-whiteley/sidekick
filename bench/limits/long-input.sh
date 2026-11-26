#!/usr/bin/env bash
# One very long typed question: N characters of made-up text, typed in pieces, then sent.
# Usage: ADB=... bash bench/limits/long-input.sh <chars>
# Prints the answer time or the error the app showed.
set -u
here=$(cd "$(dirname "$0")" && pwd)
. "$here/lib.sh"
n=${1:-4000}
words=(the parcel for flat three is at the front desk and the plumber comes on tuesday between eight
  and twelve while the spare key sits under the blue flower pot near the old shed by the river)
text="Summarise this note in one sentence"
i=0
while [ ${#text} -lt "$n" ]; do text="$text ${words[$((i % ${#words[@]}))]}"; i=$((i + 1)); done
ensure
a logcat -c
field=$(center "Ask Sidekick")
[ -z "$field" ] && { echo "composer not found" >&2; exit 1; }
tap $field
sleep 0.5
for ((o = 0; o < ${#text}; o += 400)); do typetext "${text:o:400}"; done
sleep 1
send=$(center "| Send |")
[ -z "$send" ] && { echo "send not found" >&2; exit 1; }
t0=$(date +%s)
tap $send
while [ $(($(date +%s) - t0)) -lt 300 ]; do
  sleep 3
  ensure
  guard
  l=$(a logcat -d -s ReactNativeJS:V | grep -E "\[ask\] |went wrong|\[chat\]")
  echo "$l" | grep -qE "\[ask\] |went wrong" && break
  ui | grep -q "went wrong" && { echo "app shows: Something went wrong"; break; }
done
echo "chars=${#text} wall=$(($(date +%s) - t0))s"
echo "$l"
a logcat -d | grep -E "SidekickLlm|too long|context window" | tail -5
