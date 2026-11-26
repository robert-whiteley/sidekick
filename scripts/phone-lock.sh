#!/usr/bin/env bash
# One agent at a time on the shared test phone. Silent on success.
#   scripts/phone-lock.sh take <name>   # fails if someone else holds it (stale after 60 min)
#   scripts/phone-lock.sh give          # restores Sidekick's networking, then releases
#   scripts/phone-lock.sh who           # prints the holder, if any
# adb commands from Claude sessions are refused while nobody holds it (scripts/claude-guard.py).
set -u
LOCK="${SIDEKICK_PHONE_LOCK:-/tmp/claude-$(id -u)/sidekick-phone.lock}"
ADB="${ADB:-$(ls /mnt/c/Users/*/AppData/Local/Android/Sdk/platform-tools/adb.exe 2>/dev/null | head -1)}"; ADB="${ADB:-adb}" # privacy-allow (wildcard, no name)
PKG=app.ondevice.sidekick
MAX_MIN=60

age_min() { echo $((($(date +%s) - $(stat -c %Y "$LOCK" 2>/dev/null || date +%s)) / 60)); }

case "${1:-}" in
  take)
    name="${2:?usage: phone-lock.sh take <name>}"
    mkdir -p "$(dirname "$LOCK")"
    if ! mkdir "$LOCK" 2>/dev/null; then
      holder=$(cat "$LOCK/owner" 2>/dev/null)
      [ "$holder" = "$name" ] && exit 0
      if [ "$(age_min)" -lt "$MAX_MIN" ]; then
        echo "Phone in use by ${holder:-someone} for $(age_min) min; do offline work and retry." >&2; exit 1
      fi
      rm -rf "$LOCK"; mkdir "$LOCK" || exit 1
    fi
    echo "$name" >"$LOCK/owner"
    # Heavy tests stop below 15% battery or above 45 °C.
    read -r level temp < <("$ADB" shell dumpsys battery 2>/dev/null | tr -d '\r' \
      | awk -F': ' '/ level:/{l=$2} /temperature:/{t=$2} END{print l+0, t+0}')
    if [ "${level:-100}" -gt 0 ] && { [ "$level" -lt 15 ] || [ "${temp:-0}" -gt 450 ]; }; then
      rm -rf "$LOCK"; echo "Phone battery ${level}% / $((temp / 10)) °C: too low or too hot for tests." >&2; exit 1
    fi
    ;;
  give)
    [ -d "$LOCK" ] || exit 0
    # Offline tests switch Sidekick's networking off; always switch it back.
    "$ADB" shell cmd connectivity set-package-networking-enabled true "$PKG" >/dev/null 2>&1
    "$ADB" shell cmd connectivity set-chain3-enabled false >/dev/null 2>&1
    rm -rf "$LOCK"
    ;;
  who)
    [ -d "$LOCK" ] && echo "$(cat "$LOCK/owner" 2>/dev/null) ($(age_min) min)"
    ;;
  *)
    echo "usage: phone-lock.sh take <name> | give | who" >&2; exit 2 ;;
esac
exit 0
