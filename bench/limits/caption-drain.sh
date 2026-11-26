#!/usr/bin/env bash
# Do frame captions hold back on a charger that can't keep up? On the charger, fakes a falling
# battery level (dumpsys battery set level; the real battery is untouched), watches the app's
# "[frames] captioned" lines, then restores the real battery reading.
# Usage: ADB=... bash bench/limits/caption-drain.sh <minutes per phase>
# Needs: on the charger, Sidekick open and left alone (captions wait 2 min after the last use),
# stored camera frames not yet captioned, "Describe camera frames" not Off.
set -u
here=$(cd "$(dirname "$0")" && pwd)
. "$here/lib.sh"
min=${1:-4}
trap 'a shell dumpsys battery reset' EXIT
count() { a logcat -d -s ReactNativeJS:V | grep -c "\[frames\] captioned"; }
phase() {
  a logcat -c
  sleep $((min * 60))
  echo "$1: $(count) frames captioned in $min min ($(batt))"
}
ensure
phase "charger keeping up"
lvl=$(a shell dumpsys battery | awk -F': ' '/ level/{print $2}')
a shell dumpsys battery set level $((lvl - 3))
sleep 40
a shell dumpsys battery set level $((lvl - 5))
phase "battery falling on the charger (faked)"
a shell dumpsys battery reset
phase "real reading back"
