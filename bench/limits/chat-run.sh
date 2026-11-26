#!/usr/bin/env bash
# Long chat session: types each line of a questions file into the chat, waits for the answer and
# logs per turn: answer time, first-word time, app memory (PSS), app CPU time, battery.
# Usage: ADB=... bash bench/limits/chat-run.sh bench/limits/long-chat.txt [gap_seconds]
# Output: $OUT/chat-run.tsv (turn, ms, ttft_ms, pss_mb, cpu_s, battery, status)
set -u
here=$(cd "$(dirname "$0")" && pwd)
. "$here/lib.sh"
qs=$1
gap=${2:-2}
tsv="$OUT/chat-run.tsv"
echo -e "turn\tms\tttft_ms\tpss_mb\tcpu_s\tbattery\tstatus\tquestion" >"$tsv"
ensure; field=$(center "Ask Sidekick")
[ -z "$field" ] && { echo "composer not found" >&2; exit 1; }
send=""
n=0
while IFS= read -r q <&3; do
  [ -z "$q" ] && continue
  n=$((n + 1))
  ensure; a logcat -c
  # Found again each turn: the keyboard moves the composer.
  field=$(center "Ask Sidekick")
  [ -z "$field" ] && { echo "composer not found" >&2; exit 1; }
  tap $field
  sleep 0.5
  typetext "$q"
  sleep 0.5
  send=$(center "| Send |")
  [ -z "$send" ] && { echo "send not found" >&2; exit 1; }
  t0=$(date +%s)
  tap $send
  st=timeout ms="" ttft=""
  while [ $(($(date +%s) - t0)) -lt 240 ]; do
    sleep 2; ensure; guard
    l=$(a logcat -d -s ReactNativeJS:V | grep -E "\[ask\] |went wrong|\[chat\]" )
    if echo "$l" | grep -q "\[ask\] failed"; then st=error; break; fi
    # Older builds don't log a failure: look for the app's error line every ~20 s.
    if [ $(( ($(date +%s) - t0) % 20 )) -lt 3 ] && ui | grep -q "went wrong"; then st=error; break; fi
    if echo "$l" | grep -q "\[ask\] "; then
      ms=$(echo "$l" | grep "\[ask\] " | tail -1 | sed -E 's/.*\[ask\] [a-z]+ ([0-9.]+) ms ttft ([0-9.]+) ms.*/\1/')
      ttft=$(echo "$l" | grep "\[ask\] " | tail -1 | sed -E 's/.*ttft ([0-9.]+) ms.*/\1/')
      st=ok
      break
    fi
    if echo "$l" | grep -q "went wrong"; then st=error; break; fi
  done
  echo "$l" | grep "\[chat\]" >>"$OUT/compactions.log"
  wall=$(($(date +%s) - t0))
  cpu=$(cpu_ticks)
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$n" "${ms:-${wall}000}" "${ttft:-}" "$(pss_mb)" \
    "$((${cpu:-0} / 100))" "$(batt)" "$st" "$q" | tee -a "$tsv"
  sleep "$gap"
done 3<"$qs"
