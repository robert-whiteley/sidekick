#!/bin/bash
# Downloads what the interpreter bench needs into DIR (default: ./models next to this script):
# speech models (sherpa-onnx releases), Gemma 4 E2B (the app's .litertlm), Kokoro and Piper voices
# for the made-up audio, and Firefox Translations models (fetch_mt.py). About 4.5 GB.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
D="${1:-$HERE/models}"
mkdir -p "$D" && cd "$D"
S=https://github.com/k2-fsa/sherpa-onnx/releases/download
for m in asr-models/sherpa-onnx-whisper-base asr-models/sherpa-onnx-whisper-small \
  asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8 \
  asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09 \
  tts-models/kokoro-multi-lang-v1_0 tts-models/vits-piper-de_DE-thorsten-medium; do
  n=$(basename $m)
  [ -d $n ] || (curl -sSL -o $n.tar.bz2 $S/$m.tar.bz2 && tar xjf $n.tar.bz2 && rm $n.tar.bz2)
done
[ -f gemma-4-E2B-it.litertlm ] || curl -sSL -o gemma-4-E2B-it.litertlm \
  https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it.litertlm
python3 "$HERE/fetch_mt.py" mt
