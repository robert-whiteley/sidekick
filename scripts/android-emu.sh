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

# No stdin for adb: it would eat the input of a `while read` loop.
A() { adb -s "$SERIAL" "$@" </dev/null; }
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
answers() {
  local n
  n=$(grep -acE '\[ask\] (text|photo|stopped|failed)' "$LOGS/app.log" 2>/dev/null)
  echo "${n:-0}"
}
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
  # While an answer streams, the screen never settles and uiautomator often can't read it, so
  # this reads the screen only when it must: the field is tapped only when the keyboard is down,
  # and the message goes with Send when it can be found, else with the keyboard's send key.
  if ! A shell dumpsys input_method | grep -q 'mInputShown=true'; then
    tap '^(Ask Sidekick|Ask about it)$' || { home && tap '^(Ask Sidekick|Ask about it)$'; } || return 1
    sleep 1
  fi
  type_text "$1"
  sleep 2
  local c
  if c=$(where '^Send$'); then
    # shellcheck disable=SC2086
    A shell input tap $c
  else
    A shell input keyevent KEYCODE_ENTER
  fi
}
# idle: until no answer is running (no Stop button), so each flow starts on a quiet chat.
idle() { wait_gone '^Stop$' "${1:-$SLOW}"; }
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
  web_no offline_queue folder_search send_queue delete_confirm screens decide)

flow_first_run() {
  A shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
  # The rest of the first-run downloads (speech, photo text) come from the internet here.
  wait_for 'Getting Sidekick ready|Ask Sidekick' 120 || return 1
  shot first_run_setup
  # Some emulator boots come up on mobile data, not Wi-Fi: then the app asks first, as on a phone.
  sleep 5
  has '^Download now$' && { note 'on mobile data: Download now'; tap '^Download now$'; }
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
  ask 'Turn on online lookup' || return 1
  wait_for '^Approve$' 30 || { note 'no Approve card: not routed to the setting'; return 1; }
  shot settings_approve_card
  sleep 2 # Approve works only after a short wait
  tap '^Approve$' || return 1
  wait_for 'Done: turn on online lookup|is now on' 60
}

flow_web_no() {
  # With Online off, each answer is followed by the short WEB/NO check (does this need the web?);
  # it must finish and log its result for every question.
  has '^Online: ' && { tap '^Online: ' || return 1; }
  wait_for '^Offline: answers come only' 30 || return 1
  local q fail=0 n end
  for q in 'Who won the 2026 Tour de France?' 'What is 17 times 23?' 'What did I do yesterday?'; do
    n=$(grep -ac 'offline answer' "$LOGS/app.log")
    ask "$q" || { fail=1; continue; }
    end=$((SECONDS + 120))
    until [ "$(grep -ac 'offline answer' "$LOGS/app.log")" -gt "$n" ]; do
      [ $SECONDS -ge $end ] && { note "no WEB/NO result after: $q"; fail=1; break; }
      sleep 3
    done
  done
  keyboard_down
  online_on || fail=1
  return $fail
}
# online_on: online lookup on, with the chat's Online button (as a user would).
online_on() {
  has '^Online: ' && return 0
  tap '^Offline: answers come only' || return 1
  wait_for '^Online: ' 30
}

flow_offline_queue() {
  # Airplane mode, as on a phone: the app goes by the system's network state. Online lookup on
  # first, or the weather would be answered offline instead of queued.
  online_on || return 1
  A shell cmd connectivity airplane-mode enable
  sleep 5
  local ok=0
  send "What's the weather in Leeds tomorrow?" || ok=1
  if [ $ok = 0 ]; then
    wait_for 'Waiting for the internet' "$SLOW" || ok=1
    shot offline_waiting
    [ $ok = 0 ] && { tap '^Cancel$' || ok=1; }
    [ $ok = 0 ] && { wait_gone 'Waiting for the internet' 30 || ok=1; }
  fi
  A shell cmd connectivity airplane-mode disable
  local end=$((SECONDS + 60))
  until A shell ping -c 1 -W 2 8.8.8.8 >/dev/null 2>&1 || [ $SECONDS -ge $end ]; do sleep 2; done
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
  local stop before started
  started=$(grep -ac '\[decide\] answer' "$LOGS/app.log")
  before=$(answers)
  send 'Write a 300 word story about a lighthouse keeper named Tamsin' || return 1
  wait_for '^Stop$' 120 || return 1
  # Where Stop is (keyboard down, as when it is tapped), read now: once the words stream the
  # screen may not be readable.
  keyboard_down
  stop=$(where '^Stop$') || return 1
  send 'What is the capital of France?' || return 1
  sleep 3
  shot send_queue_queued
  if has '^(Next|Queued)$'; then
    has '^Send now$' || { note 'no Send now on the queued message'; return 1; }
  else
    note 'the screen could not be read while answering; the queue is checked by its answer below'
  fi
  keyboard_down
  # Wait for the story's first words, so Stop leaves a part-answer marked Stopped.
  local end=$((SECONDS + 300))
  until [ "$(grep -ac '\[decide\] answer' "$LOGS/app.log")" -gt "$started" ]; do
    [ $SECONDS -ge $end ] && { note 'the story never started'; return 1; }
    sleep 3
  done
  sleep 20
  # shellcheck disable=SC2086
  A shell input tap $stop
  wait_answers $((before + 2)) || return 1
  sleep 3
  has '^Stopped$' || { note 'no Stopped on the part-answer'; return 1; }
  has 'Paris' || { note 'the queued question was not answered'; return 1; }
}

flow_delete_confirm() {
  ask 'Delete everything from the last hour' || return 1
  wait_for 'Type DELETE to confirm' 30 || { note 'no DELETE sheet: not routed to deleting'; return 1; }
  shot delete_sheet
  tap '^DELETE$' || return 1 # the empty field shows DELETE as its hint
  sleep 1
  type_text 'DELETE'
  sleep 1
  keyboard_down
  tap '^Delete$' || return 1
  wait_gone 'Type DELETE to confirm' 60
}

flow_screens() {
  # Every settings and app page, opened by link: a screenshot and the text of each; fails when a
  # page doesn't open in Sidekick or shows nothing.
  local p fail=0
  for p in settings settings/assistant settings/features settings/models settings/phone-search \
    settings/pictures settings/privacy settings/routines settings/camera settings/advanced \
    settings/connections about storage memory whats-new; do
    A shell "am start -a android.intent.action.VIEW -d 'sidekick://$p'" >/dev/null
    sleep 4
    local name=screen-${p//\//-}
    shot "$name"
    texts >"$LOGS/$name.txt" 2>/dev/null
    if ! A shell dumpsys window | grep -a 'mCurrentFocus' | grep -q "$PKG" ||
      [ "$(grep -c . "$LOGS/$name.txt")" -lt 3 ]; then
      note "page $p did not open"
      fail=1
    fi
  done
  home
  return $fail
}

flow_decide() {
  # The decide bench (every routing item in src/engine/decide-bench.ts) with the app's prompt:
  # each item's result goes to decide.jsonl and the score to results.txt. Fails only when the
  # bench doesn't finish; the score is for reading, as on a phone.
  local n
  n=$(grep -ac '\[bench\] decide done' "$LOGS/app.log")
  bench 'run=decide&variant=app'
  local end=$((SECONDS + 7000))
  until [ "$(grep -ac '\[bench\] decide done' "$LOGS/app.log")" -gt "$n" ]; do
    logged 'decide failed' && { note 'the decide bench failed'; return 1; }
    [ $SECONDS -ge $end ] && { note 'the decide bench did not finish'; return 1; }
    sleep 20
  done
  grep -ao '\[decide\] {.*' "$LOGS/app.log" | cut -c10- >"$LOGS/decide.jsonl"
  grep -ao '\[decide\] summary .*' "$LOGS/app.log" | tail -1 | tee -a "$LOGS/results.txt"
}

# ---------- commands ----------
case "${1:-}" in
  setup)
    apk=$2 models=$3
    A install -r -g "$apk" || exit 1
    A shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS 2>/dev/null || true
    A shell svc wifi enable 2>/dev/null || true
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
      [ "$f" = first_run ] || idle >/dev/null || true
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
