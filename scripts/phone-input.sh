#!/usr/bin/env bash
# Every tap, swipe, key or text on the test phone goes through here (Claude sessions can't call
# `adb shell input` directly: scripts/claude-guard.py). Silent when it sends; refuses (exit 3) when
# Sidekick isn't the app in front, the phone isn't taken, the target is the status bar, or the
# battery is too low or hot.
#   scripts/phone-input.sh tap X Y | swipe X1 Y1 X2 Y2 [MS] | text "words" | key KEYCODE_BACK
set -u
LOCK="${SIDEKICK_PHONE_LOCK:-/tmp/claude-$(id -u)/sidekick-phone.lock}"
ADB="${ADB:-$(ls /mnt/c/Users/*/AppData/Local/Android/Sdk/platform-tools/adb.exe 2>/dev/null | head -1)}"; ADB="${ADB:-adb}" # privacy-allow (wildcard, no name)
PKG=app.ondevice.sidekick
STATUS_BAR=${STATUS_BAR:-90} # px from the top (Pixel 5 status bar): never touched

stop() { echo "phone-input: $*" >&2; exit 3; }
[ -d "$LOCK" ] || stop "take the phone first: scripts/phone-lock.sh take <name>"

kind="${1:-}"; shift || true
case "$kind" in
  tap) [ $# -eq 2 ] || stop "tap X Y"; [ "$2" -ge "$STATUS_BAR" ] || stop "no taps in the status bar" ;;
  swipe)
    [ $# -ge 4 ] || stop "swipe X1 Y1 X2 Y2 [MS]"
    { [ "$2" -ge "$STATUS_BAR" ] && [ "$4" -ge "$STATUS_BAR" ]; } || stop "no swipes from or into the status bar" ;;
  text) [ $# -eq 1 ] || stop 'text "words"' ;;
  key)
    [ $# -eq 1 ] || stop "key KEYCODE_..."
    case "$1" in *POWER* | *SLEEP* | *LOCK* | *NOTIFICATION* | *ASSIST* | *CALL* | 26 | 223 | 276 | 5)
      stop "$1 would leave Sidekick or lock the phone" ;; esac ;;
  *) stop "tap | swipe | text | key" ;;
esac

# HOME is the way out after a focus loss: no further checks.
[ "$kind" = key ] && [ "$1" = KEYCODE_HOME ] && exec "$ADB" shell input keyevent KEYCODE_HOME

# Battery: checked at most once a minute.
stamp="$LOCK/battery-ok"
if [ ! -f "$stamp" ] || [ $(($(date +%s) - $(stat -c %Y "$stamp"))) -gt 60 ]; then
  read -r level temp < <("$ADB" shell dumpsys battery 2>/dev/null | tr -d '\r' \
    | awk -F': ' '/ level:/{l=$2} /temperature:/{t=$2} END{print l+0, t+0}')
  if [ "${level:-0}" -gt 0 ] && { [ "$level" -lt 15 ] || [ "${temp:-0}" -gt 450 ]; }; then
    stop "battery ${level}% / $((temp / 10)) °C: stop heavy tests"
  fi
  touch "$stamp"
fi

# Sidekick must be in front (a short system popup is waited out; nothing is sent meanwhile).
for i in 1 2 3 4; do
  focus=$("$ADB" shell dumpsys window 2>/dev/null | tr -d '\r' | grep -m1 mCurrentFocus)
  case "$focus" in *"$PKG/"*) break ;; esac
  [ "$i" = 4 ] && stop "Sidekick is not in front (${focus:-no window}); stopped. Report it; at most one HOME key."
  sleep "${FOCUS_WAIT:-2}"
done

case "$kind" in
  tap) exec "$ADB" shell input tap "$1" "$2" ;;
  swipe) exec "$ADB" shell input swipe "$@" ;;
  text) exec "$ADB" shell input text "$(printf '%s' "$1" | sed "s/ /%s/g; s/['\"&|;<>()\$\`\\\\]/\\\\&/g")" ;;
  key) exec "$ADB" shell input keyevent "$1" ;;
esac
