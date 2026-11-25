#!/usr/bin/env bash
# Connects adb to the test phone over Wi-Fi with no manual steps (after a one-time pairing).
# Prints the adb serial to use. The phone's address is cached outside the repo.
set -u
ADB="${ADB:-$(ls /mnt/c/Users/*/AppData/Local/Android/Sdk/platform-tools/adb.exe 2>/dev/null | head -1)}"; ADB="${ADB:-adb}"
CACHE="$HOME/.cache/sidekick-phone"
ready() { "$ADB" devices | tr -d '\r' | awk '$2=="device"{print $1}' | head -1; }
s=$(ready); [ -n "$s" ] && { echo "$s"; exit 0; }
try() { "$ADB" connect "$1" 2>/dev/null | grep -q "connected to" && { echo "${1%%:*}" >"$CACHE"; sleep 1; ready; exit 0; }; }
ip=$(cat "$CACHE" 2>/dev/null)
[ -n "$ip" ] && try "$ip:5555"
# Wireless debugging's own port (changes each time it is switched on).
for svc in $("$ADB" mdns services 2>/dev/null | tr -d '\r' | awk '/_adb-tls-connect/{print $NF}'); do try "$svc"; done
subnet=$(ip -4 route | awk '/src/ && !/docker/{print $1; exit}' | cut -d. -f1-3)
hosts=$( [ -n "$ip" ] && echo "$ip"; seq 2 254 | sed "s/^/$subnet./")
for h in $hosts; do nc -z -w1 "$h" 5555 2>/dev/null && try "$h:5555"; done
if [ -n "$ip" ]; then
  port=$(seq 30000 49999 | xargs -P 400 -I{} sh -c "nc -z -w1 $ip {} 2>/dev/null && echo {}" | head -1)
  [ -n "$port" ] && try "$ip:$port"
fi
echo "Phone not found: turn on Wireless debugging (Developer options)." >&2; exit 1
