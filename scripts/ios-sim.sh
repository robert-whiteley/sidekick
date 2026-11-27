#!/usr/bin/env bash
# iPhone Simulator checks on a GitHub macOS runner (.github/workflows/ios-sim.yml): builds the app
# for the Simulator (Debug, JS from Metro so console.log lines reach the log), puts the models in
# the app's folder, launches it and runs the in-app flows check (src/engine/flows-bench.ts).
#
#   scripts/ios-sim.sh build <repo dir>            build <repo dir>/ios/build/.../Sidekick.app
#   scripts/ios-sim.sh boot                        boot an iPhone simulator, print its id
#   scripts/ios-sim.sh models <out dir>            download the chat model and embedder (checked)
#   scripts/ios-sim.sh reset                       remove the app, its data and its keychain key
#   scripts/ios-sim.sh launch <repo dir> <tag> <models dir> [<bench query>] [<wait s>]
#       install that build over what is there (data kept, like an App Store update), start its
#       Metro, launch, optionally open sidekick://bench?<query>, wait for "[bench] ... done" or
#       <wait s>, then save logs/<tag>-*.log and a screenshot.
set -euo pipefail

BUNDLE=app.ondevice.sidekick
LOGS=${LOGS:-$PWD/logs}
mkdir -p "$LOGS"

app_path() {
  find "$1/ios/build/Build/Products/Debug-iphonesimulator" -maxdepth 1 -name 'Sidekick.app' | head -1
}

case "${1:-}" in
  build)
    dir=$2
    cd "$dir"
    npx expo prebuild --platform ios --no-install
    (cd ios && USE_CCACHE=1 pod install)
    (cd ios && xcodebuild build -quiet -workspace Sidekick.xcworkspace -scheme Sidekick \
      -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
      -derivedDataPath build ARCHS=arm64 ONLY_ACTIVE_ARCH=YES CODE_SIGNING_ALLOWED=NO)
    test -d "$(app_path "$dir")"
    ;;
  boot)
    udid=$(xcrun simctl list devices available -j | node -e '
      const d = JSON.parse(require("fs").readFileSync(0, "utf8")).devices;
      const all = Object.entries(d).filter(([r]) => r.includes("iOS")).flatMap(([, v]) => v);
      const p = all.filter((x) => /^iPhone \d+$/.test(x.name)).pop() ?? all.find((x) => x.name.startsWith("iPhone"));
      console.log(p.udid);')
    xcrun simctl boot "$udid" || true
    xcrun simctl bootstatus "$udid" -b >/dev/null
    echo "$udid"
    ;;
  models)
    out=$2
    mkdir -p "$out"
    node -e '
      const s = require("fs").readFileSync("src/engine/models.ts", "utf8");
      const hf = /const HF = .(.+?).;/.exec(s)[1];
      const pick = (start) => {
        const b = s.slice(s.indexOf(start));
        const name = /name: .(.+?).,/.exec(b)[1];
        const url = /url: (.+?),\n/.exec(b)[1].replace(/[`\x27]/g, "").replace("${HF}", hf);
        const sha = /sha256: .([0-9a-f]{64})./.exec(b)[1];
        console.log([name, url, sha].join(" "));
      };
      pick("gemmaGeneric: {");
      pick("export const EMBEDDER_FILE");' | while read -r name url sha; do
      if [ ! -f "$out/$name" ]; then
        curl -fsSL --retry 3 -o "$out/$name.part" "$url"
        echo "$sha  $out/$name.part" | shasum -a 256 -c -
        mv "$out/$name.part" "$out/$name"
      fi
    done
    ls -la "$out"
    ;;
  reset)
    # A phone that never had Sidekick: no app, no data, no keychain key (which, as on a real
    # iPhone, outlives deleting the app).
    xcrun simctl uninstall booted "$BUNDLE" 2>/dev/null || true
    xcrun simctl keychain booted reset || true
    ;;
  launch)
    dir=$2 tag=$3 models=$4 query=${5:-} wait=${6:-240}
    app=$(app_path "$dir")
    xcrun simctl terminate booted "$BUNDLE" 2>/dev/null || true
    xcrun simctl install booted "$app"
    data=$(xcrun simctl get_app_container booted "$BUNDLE" data)
    root="$data/Library/Application Support/sidekick"
    mkdir -p "$root/models"
    # The models as a finished download would leave them (hard links: no second copy on disk).
    for f in "$models"/*.litertlm; do
      ln -f "$f" "$root/models/$(basename "$f")" 2>/dev/null || cp "$f" "$root/models/"
    done
    # Bench links run only with this file (src/app/bench.tsx).
    touch "$root/bench-links"
    (cd "$dir" && CI=1 npx expo start --port 8081 >"$LOGS/$tag-metro.log" 2>&1) &
    metro=$!
    for _ in $(seq 1 90); do
      curl -fs http://localhost:8081/status >/dev/null 2>&1 && break
      sleep 2
    done
    xcrun simctl spawn booted log stream --style compact --level debug \
      --predicate 'process == "Sidekick"' >"$LOGS/$tag-device.log" 2>&1 &
    logger=$!
    xcrun simctl launch booted "$BUNDLE"
    # A Debug launch fetches the JS from Metro, which bundles it first (a minute or more).
    end=$((SECONDS + 900))
    until grep -q 'Bundled' "$LOGS/$tag-metro.log" 2>/dev/null; do
      [ $SECONDS -ge $end ] && { echo "Metro never finished the bundle"; break; }
      sleep 5
    done
    sleep 30
    if [ -n "$query" ]; then
      xcrun simctl openurl booted "sidekick://bench?$query&t=$(date +%s)"
      end=$((SECONDS + wait))
      until grep -qE '\[bench\] .* (done|failed)' "$LOGS/$tag-metro.log" "$LOGS/$tag-device.log" 2>/dev/null; do
        [ $SECONDS -ge $end ] && { echo "no '[bench] done' within ${wait}s"; break; }
        sleep 5
      done
    else
      sleep "$wait"
    fi
    xcrun simctl io booted screenshot "$LOGS/$tag.png" || true
    kill "$logger" "$metro" 2>/dev/null || true
    pkill -f 'expo start' 2>/dev/null || true
    wait 2>/dev/null || true
    # What the checks look for, in one place.
    grep -hE '\[flows\]|\[db\]|op-sqlite|SQL|not a database|database is locked|\[ask\]|\[decide\]|\[picture\]' \
      "$LOGS/$tag-metro.log" "$LOGS/$tag-device.log" >"$LOGS/$tag-summary.log" || true
    cat "$LOGS/$tag-summary.log"
    ;;
  *)
    sed -n '2,14p' "$0"
    exit 2
    ;;
esac
