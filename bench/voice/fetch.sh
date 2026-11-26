#!/bin/bash
set -e
# Downloads the models into DIR (default: ./models). Usage: bash fetch.sh [DIR]
mkdir -p "${1:-models}" && cd "${1:-models}"
S=https://github.com/k2-fsa/sherpa-onnx/releases/download
[ -f silero_vad_v6.2.3.onnx ] || curl -sSL -o silero_vad_v6.2.3.onnx https://raw.githubusercontent.com/snakers4/silero-vad/v6.2.3/src/silero_vad/data/silero_vad.onnx &
[ -f 3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx ] || curl -sSL -o 3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx https://huggingface.co/csukuangfj/speaker-embedding-models/resolve/main/3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx &
[ -d sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8 ] || (curl -sSL $S/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2 | tar xj) &
[ -d kokoro-multi-lang-v1_0 ] || (curl -sSL $S/tts-models/kokoro-multi-lang-v1_0.tar.bz2 | tar xj) &
[ -d vits-piper-en_US-libritts_r-medium ] || (curl -sSL $S/tts-models/vits-piper-en_US-libritts_r-medium.tar.bz2 | tar xj) &
wait
sha256sum *.onnx
du -sh *
