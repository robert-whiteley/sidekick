#!/usr/bin/env bash
# Android emulator checks (.github/workflows/android-emu.yml): installs the x86_64 test build on an
# emulator, gives it the models, and drives the real app through the chat the way a person would
# (typing, tapping, sharing files in), reading the screen with uiautomator and the app's log.
#
#   scripts/android-emu.sh setup <apk> <models dir>   install, push models and made-up test files
#   scripts/android-emu.sh run [<flow> ...]           first_run, then those flows (default: all)
#   scripts/android-emu.sh list                       the flow names
#
# Each flow prints PASS or FAIL into $LOGS/results.txt with a screenshot ($LOGS/<flow>.png); the
# app's log is $LOGS/app.log. Exit 1 if any flow failed or the app crashed. Everything runs on the
# emulator only (ANDROID_SERIAL, default emulator-5554): never point it at a phone.
set -uo pipefail

PKG=app.ondevice.sidekick
LOGS=${LOGS:-$PWD/logs}
SERIAL=${ANDROID_SERIAL:-emulator-5554}
HERE=$(cd "$(dirname "$0")" && pwd)
UI="$HERE/android-ui.py"
EXT=/sdcard/Android/data/$PKG/files
TEST=$EXT/sk-test
# The emulator runs the model on its CPU, so answers take minutes; every wait is generous.
SLOW=${SLOW:-600}
mkdir -p "$LOGS"
DUMP="$LOGS/.ui.xml"
FILES=${FILES:-$PWD/test-files}

A() { adb -s "$SERIAL" "$@"; }
note() { echo "[$(date +%T)] $*"; }

# ---------- the screen ----------
dump() {
  local i
  for i in 1 2 3 4 5; do
    if A shell uiautomator dump /sdcard/sk-ui.xml >/dev/null 2>&1 &&
      A shell cat /sdcard/sk-ui.xml >"$DUMP" 2>/dev/null && grep -q '<hierarchy' "$DUMP"; then
      return 0
    fi
    sleep 1
  done
  : >"$DUMP"
  return 1
}
has() { dump && python3 "$UI" has "$DUMP" "$1"; }
where() { dump && python3 "$UI" find "$DUMP" "$1"; }
texts() { dump && python3 "$UI" texts "$DUMP"; }
tap() {
  local c
  c=$(where "$1") || { note "nothing matching '$1' on screen"; return 1; }
  # shellcheck disable=SC2086
  A shell input tap $c
}
# wait_for <regex> [<seconds>]: until a text or label on screen contains a match.
wait_for() {
  local end=$((SECONDS + ${2:-$SLOW}))
  until has "$1"; do
    [ $SECONDS -ge $end ] && { note "timed out waiting for /$1/"; return 1; }
    sleep 3
  done
}
wait_gone() {
  local end=$((SECONDS + ${2:-60}))
  while has "$1"; do
    [ $SECONDS -ge $end ] && { note "still on screen: /$1/"; return 1; }
    sleep 2
  done
}
shot() { A exec-out screencap -p >"$LOGS/$1.png" 2>/dev/null || true; }
type_text() {
  # adb's input text: spaces as %s, shell characters escaped (as scripts/phone-input.sh does).
  A shell input text "$(printf '%s' "$1" | sed "s/ /%s/g; s/['\"&|;<>()\$\`\\\\?*]/\\\\&/g")"
}
keyboard_down() {
  A shell dumpsys input_method | grep -q 'mInputShown=true' && A shell input keyevent KEYCODE_BACK
  sleep 1
}
home() {
  local i
  for i in 1 2 3 4; do
    has '^(Ask Sidekick|Ask about it)$' && return 0
    A shell input keyevent KEYCODE_BACK
    sleep 1.5
  done
  A shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1
  wait_for '^(Ask Sidekick|Ask about it)$' 60
}

# ---------- the app's log ----------
answers() { grep -acE '\[ask\] (text|photo|stopped|failed)' "$LOGS/app.log" 2>/dev/null || echo 0; }
# wait_answers <count> [<seconds>]: until that many answers have finished since the run began.
wait_answers() {
  local end=$((SECONDS + ${2:-$SLOW}))
  until [ "$(answers)" -ge "$1" ]; do
    [ $SECONDS -ge $end ] && { note "timed out waiting for answer $1"; return 1; }
    sleep 3
  done
}
logged() { grep -aqE "$1" "$LOGS/app.log"; }
wait_log() {
  local end=$((SECONDS + ${2:-$SLOW}))
  until logged "$1"; do
    [ $SECONDS -ge $end ] && { note "timed out waiting for log /$1/"; return 1; }
    sleep 3
  done
}
# ask <question>: types it into the chat and sends it; then waits for its answer to finish.
send() {
  has '^(Ask Sidekick|Ask about it)$' || home || return 1
  tap '^(Ask Sidekick|Ask about it)$' || return 1
  sleep 1
  type_text "$1"
  sleep 1
  tap '^Send$'
}
ask() {
  local n
  n=$(($(answers) + 1))
  send "$1" || return 1
  wait_answers "$n" "${2:-$SLOW}"
  sleep 3
}
bench() {
  A shell "am start -a android.intent.action.VIEW -d 'sidekick://bench?$1&t=$(date +%s)'" >/dev/null
}
# share <file in sk-test> <mime>: shares a test file into Sidekick, as the share menu does.
share() {
  A shell am start -a android.intent.action.SEND -t "$2" \
    --eu android.intent.extra.STREAM "file://$TEST/$1" -n "$PKG/.MainActivity" >/dev/null
}

# ---------- flows ----------
FLOWS=(first_run interpreter_closed pasted_table file_types recording_play settings_by_voice
  offline_queue folder_search send_queue delete_confirm)

flow_first_run() {
  A shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
  # The rest of the first-run downloads (speech, photo text) come from the internet here.
  wait_for 'Getting Sidekick ready|Ask Sidekick' 120 || return 1
  shot first_run_setup
  wait_for '^Ask Sidekick$' 2400 || return 1
  wait_for 'Remind me to call Mum at 6' 60 || return 1
  bench 'run=flows&only=db'
  wait_log '\[flows\] \{"step":"db","ok":true' 300 || return 1
  home
}

flow_interpreter_closed() {
  ask 'Stop the interpreter' || return 1
  wait_for "interpreter isn.t open" 60
}

flow_pasted_table() {
  # Shared text goes into the chat box as it is (tabs and lines kept), like a paste.
  A shell "am start -a android.intent.action.SEND -t text/plain -n $PKG/.MainActivity \
    --es android.intent.extra.TEXT \"\$(cat $TEST/sk-test-table.txt)\"" >/dev/null
  wait_for 'What is the total cost for each team' 60 || return 1
  local n=$(($(answers) + 1))
  tap '^Send$' || return 1
  wait_answers "$n" || return 1
  sleep 3
  local t
  t=$(texts)
  local miss=0 v
  for v in '31\.49' '33\.35' '15\.24'; do
    echo "$t" | grep -qE "$v" || { note "no $v in the answer"; miss=1; }
  done
  return $miss
}

flow_file_types() {
  local fail=0 f mime q want
  while IFS='|' read -r f mime q want; do
    note "file $f"
    share "$f" "$mime"
    if ! wait_for '^Ask about it$' 60; then
      fail=1
      continue
    fi
    if ! ask "$q"; then
      fail=1
    elif ! has "$want"; then
      note "$f: no /$want/ in the answer"
      fail=1
    fi
    shot "file_${f##*.}"
    tap '^Stop asking about this$' >/dev/null 2>&1 || true
    sleep 1
  done <<'EOF'
sk-test-letter.docx|application/vnd.openxmlformats-officedocument.wordprocessingml.document|What is the entry fee per rower?|12
sk-test-prices.xlsx|application/vnd.openxmlformats-officedocument.spreadsheetml.sheet|What is the total of the net prices?|195
sk-test-runs.csv|text/csv|How many kilometres did I run in total?|25[.,]8
sk-test-slides.pptx|application/vnd.openxmlformats-officedocument.presentationml.presentation|How much of the budget was spent?|41[ ,.]?300
sk-test-story.epub|application/epub+zip|What is the fox called?|Tobble
sk-test-bundle.zip|application/zip|What is on the packing list?|[Tt]ent
sk-test-data.qzx|application/octet-stream|What is in this file?|qzx|read|open|binary|kind
EOF
  return $fail
}

flow_recording_play() {
  bench 'run=flows&only=heard'
  wait_log '\[flows\] \{"step":"heard","ok":true' 300 || return 1
  home || return 1
  ask 'What did Tom say about the plumber?' || return 1
  has 'Tuesday' || { note 'the answer does not say Tuesday'; return 1; }
  # The play button is added once a short model check has picked the line the answer used.
  wait_for '^Play the recording$' 300
}

flow_settings_by_voice() {
  send 'Turn on online lookup' || return 1
  wait_for '^Approve$' "$SLOW" || return 1
  shot settings_approve_card
  sleep 2 # Approve works only after a short wait
  tap '^Approve$' || return 1
  wait_for 'is now on' 60
}

flow_offline_queue() {
  # Only Sidekick loses the internet; the emulator stays online.
  A shell cmd connectivity set-package-networking-enabled false "$PKG"
  sleep 3
  local ok=0
  ask "What's the weather in Leeds tomorrow?" || ok=1
  if [ $ok = 0 ]; then
    wait_for 'Waiting for the internet' 60 || ok=1
    shot offline_waiting
    [ $ok = 0 ] && { tap '^Cancel$' || ok=1; }
    [ $ok = 0 ] && { wait_gone 'Waiting for the internet' 30 || ok=1; }
  fi
  A shell cmd connectivity set-package-networking-enabled true "$PKG"
  return $ok
}

flow_folder_search() {
  A shell mkdir -p /sdcard/Documents
  A push "$FILES/folder/." /sdcard/Documents/ >/dev/null || return 1
  A shell "am start -a android.intent.action.VIEW -d 'sidekick://settings/phone-search'" >/dev/null
  wait_for '^Search folders I choose$' 60 || return 1
  has '^Add Documents$' || tap '^Search folders I choose$' || return 1
  wait_for '^Add Documents$' 30 || return 1
  tap '^Add Documents$' || return 1
  # The phone's own folder picker (DocumentsUI), opened at Documents.
  wait_for '^Use this folder$' 60 || return 1
  shot folder_picker
  tap '^Use this folder$' || return 1
  wait_for '^Allow$' 30 || return 1
  tap '^Allow$' || return 1
  wait_for '[1-9][0-9]* passages read' 300 || return 1
  home || return 1
  ask 'Find my latest invoice from Acme and tell me the total' || return 1
  has '184[.,]50' || { note 'no 184.50 in the answer'; return 1; }
}

flow_send_queue() {
  send 'Write a 300 word story about a lighthouse keeper named Tamsin' || return 1
  wait_for '^Stop$' 120 || return 1
  local before
  before=$(answers)
  send 'What is the capital of France?' || return 1
  wait_for '^(Next|Queued)$' 30 || return 1
  has '^Send now$' || { note 'no Send now on the queued message'; return 1; }
  shot send_queue_queued
  keyboard_down
  # Wait for the first words, so Stop leaves a part-answer marked Stopped.
  wait_log '\[decide\]' 300 || return 1
  sleep 20
  tap '^Stop$' || return 1
  wait_for '^Stopped$' 60 || return 1
  wait_answers $((before + 2)) || return 1
  sleep 3
  has 'Paris' || { note 'the queued question was not answered'; return 1; }
}

flow_delete_confirm() {
  send 'Delete everything from the last hour' || return 1
  wait_for 'Type DELETE to confirm' "$SLOW" || return 1
  shot delete_sheet
  tap '^DELETE$' || return 1 # the empty field shows DELETE as its hint
  sleep 1
  type_text 'DELETE'
  sleep 1
  keyboard_down
  tap '^Delete$' || return 1
  wait_gone 'Type DELETE to confirm' 60
}

# ---------- commands ----------
case "${1:-}" in
  setup)
    apk=$2 models=$3
    A install -r -g "$apk" || exit 1
    A shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS 2>/dev/null || true
    A shell mkdir -p "$EXT/models" "$TEST"
    # The chat model and memory search as a finished download leaves them; the rest of the
    # first-run downloads come from the internet in first_run.
    for f in "$models"/*.litertlm; do A push "$f" "$EXT/models/" >/dev/null || exit 1; done
    python3 "$HERE/android-test-files.py" "$FILES" >/dev/null || exit 1
    for f in "$FILES"/sk-test-*; do A push "$f" "$TEST/" >/dev/null || exit 1; done
    # Bench links run only with this file (src/app/bench.tsx).
    A shell touch "$EXT/bench-links"
    A shell ls -la "$EXT/models" "$TEST"
    ;;
  run)
    shift
    # first_run always comes first: the other flows need a set-up app.
    [ $# -gt 0 ] || set -- "${FLOWS[@]:1}"
    [ "$1" = first_run ] || set -- first_run "$@"
    A logcat -c
    A logcat -v time ReactNativeJS:V AndroidRuntime:E '*:S' >"$LOGS/app.log" 2>&1 &
    applog=$!
    A logcat -v time '*:W' >"$LOGS/logcat.log" 2>&1 &
    syslog=$!
    : >"$LOGS/results.txt"
    for f in "$@"; do
      note "flow $f"
      t0=$SECONDS
      if "flow_$f"; then r=PASS; else r=FAIL; fi
      shot "$f"
      texts >"$LOGS/$f-screen.txt" 2>/dev/null || true
      echo "$r $f ($((SECONDS - t0)) s)" | tee -a "$LOGS/results.txt"
      [ "$f" = first_run ] && [ $r = FAIL ] && break # nothing else can run without it
      home >/dev/null 2>&1 || true
    done
    kill "$applog" "$syslog" 2>/dev/null
    grep -aE '\[(ask|decide|flows|bench|interpret|download|setup|llm)\]' "$LOGS/app.log" \
      >"$LOGS/summary.log" || true
    fail=0
    grep -q '^FAIL' "$LOGS/results.txt" && fail=1
    if grep -aE 'FATAL EXCEPTION|Fatal signal' "$LOGS/app.log" "$LOGS/logcat.log" | grep -a "$PKG\|FATAL" | head -5; then
      echo "the app crashed" | tee -a "$LOGS/results.txt"
      fail=1
    fi
    cat "$LOGS/results.txt"
    exit $fail
    ;;
  list) printf '%s\n' "${FLOWS[@]}" ;;
  *)
    sed -n '2,12p' "$0"
    exit 2
    ;;
esac
