#!/usr/bin/env bash
# Builds dex.zip (the harness plus LiteRT-LM's Android library) for app_process on a phone.
#   bench/models/build.sh <litertlm-android version> <work dir>
# Needs JDK 21+ on PATH, ANDROID_HOME with platform 35, and network for Maven.
# Then: adb push <work dir>/lib/. /data/local/tmp/mc/ (plus prompts.jsonl, images, model).
set -euo pipefail
V=$1
W=$2
HERE=$(cd "$(dirname "$0")" && pwd)
JAR=${ANDROID_HOME:?set ANDROID_HOME}/platforms/android-35/android.jar
G=https://dl.google.com/android/maven2
M=https://repo1.maven.org/maven2
mkdir -p "$W/lib"
cd "$W"
get() { [ -f "$2" ] || curl -sfL -o "$2" "$1"; }
get "$G/com/google/ai/edge/litertlm/litertlm-android/$V/litertlm-android-$V.aar" lm.aar
get "$G/com/google/ai/edge/litertlm/litertlm-android/$V/litertlm-android-$V.pom" lm.pom
get "$M/org/jetbrains/kotlin/kotlin-stdlib/2.4.0/kotlin-stdlib-2.4.0.jar" stdlib.jar
get "$M/org/jetbrains/kotlin/kotlin-reflect/2.4.0/kotlin-reflect-2.4.0.jar" reflect.jar
get "$M/org/jetbrains/kotlinx/kotlinx-coroutines-core-jvm/1.11.0/kotlinx-coroutines-core-jvm-1.11.0.jar" coroutines.jar
get "$M/com/google/code/gson/gson/2.14.0/gson-2.14.0.jar" gson.jar
# r8 rather than build-tools d8: 0.20+ ships Java 25 class files.
get "$G/com/android/tools/r8/9.5.33/r8-9.5.33.jar" r8.jar
rm -rf lm && unzip -q -o lm.aar -d lm && cp lm/jni/arm64-v8a/*.so lib/
jars=(lm/classes.jar)
# 0.20+ depends on LiteRT itself, which supplies libLiteRt.so.
LV=$(grep -A1 '<artifactId>litert</artifactId>' lm.pom | grep -o '[0-9][0-9.]*' || true)
if [ -n "$LV" ]; then
  get "$G/com/google/ai/edge/litert/litert/$LV/litert-$LV.aar" lr.aar
  rm -rf lr && unzip -q -o lr.aar -d lr && cp lr/jni/arm64-v8a/*.so lib/
  jars+=(lr/classes.jar)
fi
rm -rf cls && mkdir cls
CP=$(IFS=:; echo "${jars[*]}"):stdlib.jar:coroutines.jar:gson.jar:$JAR
javac -nowarn --release 21 -cp "$CP" -d cls "$HERE/Main.java"
(cd cls && jar cf ../main.jar .)
java -cp r8.jar com.android.tools.r8.D8 --release --min-api 30 --lib "$JAR" --output lib/dex.zip \
  main.jar "${jars[@]}" stdlib.jar coroutines.jar gson.jar reflect.jar
cp "$HERE/run.sh" "$HERE/prompts.jsonl" lib/
echo "Built $W/lib"
