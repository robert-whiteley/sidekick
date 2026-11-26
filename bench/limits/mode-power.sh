#!/usr/bin/env bash
# Power and CPU for one mode over a fixed window (works on the charger: compares modes by Android's
# per-app power estimate and CPU time; unplugged it also gives real drain).
# Usage: ADB=... bash bench/limits/mode-power.sh <label> <minutes>
# Set the mode up first (app closed / Listen on / Live camera on / both). Appends to $OUT/modes.tsv:
# label, minutes, app CPU s, app CPU % of one core, app estimated mAh, battery start/end, temp.
set -u
here=$(cd "$(dirname "$0")" && pwd)
. "$here/lib.sh"
label=$1
min=$2
uid=$(a shell dumpsys package "$PKG" | awk -F'[= ]' '/userId=/{for(i=1;i<=NF;i++) if($i=="userId") {print $(i+1); exit}}')
a shell dumpsys batterystats --reset >/dev/null
# CPU time of every process of the app's uid (service and app share one process today).
ticks() { a shell "for p in \$(pidof $PKG); do cat /proc/\$p/stat; done" | awk '{s+=$14+$15} END{print s+0}'; }
c0=$(ticks)
b0=$(batt)
t0=$(date +%s)
: >"$OUT/$label-samples.tsv"
while [ $(($(date +%s) - t0)) -lt $((min * 60)) ]; do
  echo -e "$(($(date +%s) - t0))\t$(batt)\t$(pss_mb)\t$(ticks)" >>"$OUT/$label-samples.tsv"
  sleep 60
done
c1=$(ticks)
b1=$(batt)
secs=$(($(date +%s) - t0))
a shell dumpsys batterystats >"$OUT/$label-batterystats.txt"
# "Estimated power use" per uid: the app is u0aNNN (uid - 10000).
short="u0a$((uid - 10000))"
mah=$(grep -A200 "Estimated power use" "$OUT/$label-batterystats.txt" | grep -m1 "UID $short:" | awk '{print $3}')
cpu=$(((c1 - c0) / 100))
echo -e "$label\t$min\t$cpu\t$((cpu * 100 / secs))\t${mah:-?}\t$b0\t$b1" | tee -a "$OUT/modes.tsv"
