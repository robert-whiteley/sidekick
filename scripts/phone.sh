#!/usr/bin/env bash
# Connects adb to the test phone over Wi-Fi with no manual steps (after a one-time pairing).
# Prints the adb serial to use. The phone's address is cached outside the repo.
set -u
ADB="${ADB:-$(ls /mnt/c/Users/*/AppData/Local/Android/Sdk/platform-tools/adb.exe 2>/dev/null | head -1)}"; ADB="${ADB:-adb}" # privacy-allow (wildcard, no name)
CACHE="$HOME/.cache/sidekick-phone"
ready() { "$ADB" devices | tr -d '\r' | awk '$2=="device"{print $1}' | head -1; }
s=$(ready); [ -n "$s" ] && { echo "$s"; exit 0; }
# Drop stale (offline) Wi-Fi connections first.
"$ADB" devices | tr -d '\r' | awk '$2=="offline"{print $1}' | xargs -r -n1 "$ADB" disconnect >/dev/null 2>&1
try() {
  "$ADB" disconnect "$1" >/dev/null 2>&1
  "$ADB" connect "$1" 2>/dev/null | grep -q "connected to" || return 1
  sleep 1
  local d; d=$(ready)
  [ -n "$d" ] && { echo "$1" >"$CACHE"; echo "$d"; exit 0; }
}
last=$(cat "$CACHE" 2>/dev/null); ip=${last%%:*}
# The last address and port that worked (same until Wireless debugging is switched off).
case "$last" in *:*) try "$last" ;; esac
[ -n "$ip" ] && try "$ip:5555"
# Wireless debugging's own port (changes each time it is switched on).
for svc in $("$ADB" mdns services 2>/dev/null | tr -d '\r' | awk '/_adb-tls-connect/{print $NF}'); do try "$svc"; done
if [ -n "$ip" ]; then
  port=$(seq 30000 49999 | xargs -P 1000 -I{} sh -c "nc -z -w1 $ip {} 2>/dev/null && echo {}" | head -1)
  [ -n "$port" ] && try "$ip:$port"
fi
subnet=$(ip -4 route | awk '/src/ && !/docker/{print $1; exit}' | cut -d. -f1-3)
hosts=$( [ -n "$ip" ] && echo "$ip"; seq 2 254 | sed "s/^/$subnet./")
for h in $hosts; do nc -z -w1 "$h" 5555 2>/dev/null && try "$h:5555"; done
echo "Phone not found: turn on Wireless debugging (Developer options)." >&2; exit 1
