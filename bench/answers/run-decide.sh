#!/usr/bin/env bash
# Runs the "rules vs model" or thinking bench on the phone by deep link and saves its log lines.
# Usage: bash bench/answers/run-decide.sh decide <variant> [only]   (catalog|catalog-off|
#        catalog-fill|classify|fused|fused-lookup|full|embed), thinking <budget|handoff> [only],
#        or background <budget> [only].
# background: PHOTOS = a folder adb can read (on Windows adb, a Windows path) holding the
# pictures from bench/answers/photos.py; they are pushed to the app's folder and deleted after.
# Needs ADB, a dev/bench build installed, and the bench-links flag file (bench/README.md).
# Output: $OUT/<run>-<variant>.jsonl (one line per case) and the CPU ticks / battery before/after.
set -u
source "$(dirname "$0")/../limits/lib.sh"
RUN=$1 VAR=$2 ONLY=${3:-}
ensure || { echo "no phone"; exit 2; }
F="$OUT/$RUN-$VAR.jsonl"
case $RUN in thinking) TAG=think ;; background) TAG=bg ;; *) TAG=decide ;; esac
PDIR=/sdcard/Android/data/app.ondevice.sidekick/files/bench-photos
if [ "$RUN" = background ]; then
  a shell mkdir -p "$PDIR"
  for f in sign receipt label note; do a push "${PHOTOS:?set PHOTOS}/$f.png" "$PDIR/" >/dev/null; done
fi
a logcat -c
c0=$(cpu_ticks); b0=$(batt)
url="sidekick://bench?run=$RUN\\&variant=$VAR\\&t=$(date +%s)"
[ -n "$ONLY" ] && url="$url\\&only=$ONLY"
RAW="$OUT/$RUN-$VAR.raw"
"$ADB" logcat -s ReactNativeJS >"$RAW" 2>/dev/null &
LP=$!
a shell am start -a android.intent.action.VIEW -d "$url" >/dev/null
t0=$(date +%s)
while :; do
  sleep 15
  grep -q "\[bench\] $RUN done" "$RAW" && break
  # Wireless adb drops the stream now and then: reconnect and carry on (the phone keeps lines).
  if ! kill -0 $LP 2>/dev/null; then
    ensure
    "$ADB" logcat -s ReactNativeJS -T 5000 >>"$RAW" 2>/dev/null &
    LP=$!
  fi
  [ $(($(date +%s) - t0)) -gt 2400 ] && { echo "timeout"; break; }
done
kill $LP 2>/dev/null
[ "$RUN" = background ] && a shell rm -rf "$PDIR"
tr -d '\r' <"$RAW" | grep -o "\[$TAG\] .*" | awk '!seen[$0]++' >"$F"
c1=$(cpu_ticks); b1=$(batt)
echo "{\"cpuTicks\":$((c1 - c0)),\"wallS\":$(($(date +%s) - t0)),\"battBefore\":\"$b0\",\"battAfter\":\"$b1\"}" >>"$F"
grep summary "$F"; tail -1 "$F"
