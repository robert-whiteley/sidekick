#!/system/bin/sh
# On the phone, from the folder holding dex.zip, the .so files, prompts.jsonl, the images and the model:
#   sh run.sh <model file> <cpu|gpu> <out.jsonl> [case ids, comma-separated]
# Set MC_NOVISION=1 for a text-only model.
D=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$D/cache"
cd "$D" || exit 1
MC_CACHE=${MC_CACHE:-$D/cache} CLASSPATH=$D/dex.zip LD_LIBRARY_PATH=$D \
  exec app_process "$D" Main "$D/$1" "$2" "$D/prompts.jsonl" "$D" "$D/$3" $4
