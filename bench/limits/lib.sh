# Shared helpers for the limits bench (source it). Drives the installed Sidekick app over adb.
# Needs: ADB set (Windows adb.exe from WSL), the phone unlocked with Sidekick's chat on screen.
PKG=app.ondevice.sidekick
OUT=${OUT:-/tmp/sk-limits}
mkdir -p "$OUT"
a() { "$ADB" "$@" | tr -d '\r'; }
# Wireless adb drops now and then: reconnect (scripts/phone.sh) before giving up.
ensure() {
  "$ADB" get-state >/dev/null 2>&1 && return 0
  bash "$(dirname "${BASH_SOURCE[0]}")/../../scripts/phone.sh" >/dev/null 2>&1
  "$ADB" get-state >/dev/null 2>&1
}

# Text and bounds of every labelled node on screen.
ui() {
  "$ADB" shell uiautomator dump /sdcard/sk_ui.xml >/dev/null 2>&1
  "$ADB" exec-out cat /sdcard/sk_ui.xml >"$OUT/ui.xml"
  "$ADB" shell rm -f /sdcard/sk_ui.xml
  python3 - "$OUT/ui.xml" <<'PY'
import re, sys
x = open(sys.argv[1], encoding='utf-8', errors='ignore').read()
for m in re.finditer(r'<node [^>]*>', x):
    n = m.group(0)
    g = lambda r: (re.search(r, n).group(1) if re.search(r, n) else '')
    t, d, b = g(r' text="([^"]*)"'), g(r'content-desc="([^"]*)"'), g(r'bounds="([^"]*)"')
    if t or d: print(repr(t[:100]), '|', d[:60], '|', b)
PY
}
# Centre of the first node matching a grep pattern.
center() {
  local r i
  for i in 1 2 3; do
    r=$(center1 "$1")
    [ -n "$r" ] && { echo "$r"; return; }
    sleep 1
  done
}
center1() {
  ui | grep -- "$1" | head -1 | python3 -c "
import re,sys
m=re.findall(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]',sys.stdin.read())
if m: n=list(map(int,m[-1])); print((n[0]+n[2])//2,(n[1]+n[3])//2)"
}
# Sidekick is the app in front (never type or tap into another app: owner's privacy rule).
front() { a shell dumpsys window | grep "mCurrentFocus" | grep -q "$PKG/"; }
# A brief focus loss (a system popup) is waited out for a few seconds; nothing is sent meanwhile.
guard() { local i; for i in 1 2 3 4; do front && return 0; sleep 2; done; a shell dumpsys window | grep mCurrentFocus >&2; echo "STOP: Sidekick is not in front" >&2; exit 3; }
# Input goes through scripts/phone-input.sh (foreground, status bar and battery checks).
INPUT="$(dirname "${BASH_SOURCE[0]}")/../../scripts/phone-input.sh"
tap() { guard; "$INPUT" tap "$1" "$2" || exit 3; }
# Types text into the focused field (spaces as %s; only plain characters).
typetext() { guard; "$INPUT" text "$1" || exit 3; }
pidof_app() { a shell pidof "$PKG"; }
# Total PSS of the app process, MB.
pss_mb() { a shell dumpsys meminfo "$PKG" | awk '/TOTAL PSS:/{print int($3/1024); exit} /^ *TOTAL /{print int($2/1024); exit}'; }
# utime+stime of the app process, in clock ticks (1/100 s).
cpu_ticks() { local p; p=$(pidof_app); [ -n "$p" ] && a shell cat /proc/"$p"/stat | awk '{print $14+$15}'; }
batt() { a shell dumpsys battery | awk -F': ' '/ level/{l=$2} /temperature/{t=$2/10} END{print l"% "t"C"}'; }
