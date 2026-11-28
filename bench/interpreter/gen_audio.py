"""Speaks the interpreter bench lines (phrases.json) as 16 kHz mono WAVs with offline TTS:
the other person's lines in their language, the owner's lines in English.

    python gen_audio.py OUT_DIR MODELS_DIR [langs]

MODELS_DIR holds kokoro-multi-lang-v1_0 (Apache-2.0; es, fr, it, pt, en),
vits-piper-de_DE-thorsten-medium (MIT model, CC0 data; German) and, for Japanese,
kokoro-onnx/kokoro-v1.0.onnx + voices-v1.0.bin read through misaki's Japanese G2P (pyopenjtalk):
the sherpa-onnx Kokoro build reads Japanese through espeak-ng, which gives kanji Chinese
readings, so its "Japanese" was not Japanese. Needs sherpa-onnx 1.12.x (2.x dropped the espeak
front end these voices use), kokoro-onnx and misaki[ja] (with unidic-lite as its dictionary). Writes OUT_DIR/<lang>/<i>.wav, OUT_DIR/en/<i>.wav and the
extra Japanese lines (hear-ja.json) as OUT_DIR/ja/h<i>.wav. Audio is never committed.
"""
import json, os, sys

import numpy as np
import scipy.signal as ss
import sherpa_onnx as so
import soundfile as sf

OUT, MODELS = sys.argv[1], sys.argv[2]
LANGS = (sys.argv[3] if len(sys.argv) > 3 else 'es,fr,de,it,pt,ja').split(',')
SR = 16000
HERE = os.path.dirname(os.path.abspath(__file__))
data = json.load(open(os.path.join(HERE, 'phrases.json')))

# Kokoro v1.0 speaker ids (sherpa-onnx docs): 3 af_heart, 28 ef_dora, 29 em_alex, 30 ff_siwis,
# 35 if_sara, 36 im_nicola, 37 jf_alpha, 41 jm_kumo, 42 pf_dora, 43 pm_alex.
KOKORO = {'en': ('en-us', [3]), 'es': ('es', [28, 29]), 'fr': ('fr', [30]),
          'it': ('it', [35, 36]), 'pt': ('pt-br', [42, 43])}
JA_VOICES = ['jf_alpha', 'jm_kumo', 'jf_gongitsune', 'jf_nezumi', 'jf_tebukuro']


class Japanese:
    """Kokoro v1.0 with misaki's Japanese phonemes, shaped like sherpa-onnx's OfflineTts."""

    def __init__(self):
        from kokoro_onnx import Kokoro
        from misaki import ja
        k = f'{MODELS}/kokoro-onnx/'
        self.k, self.g = Kokoro(k + 'kokoro-v1.0.onnx', k + 'voices-v1.0.bin'), ja.JAG2P()

    def generate(self, text, sid=0, speed=1.0):
        a, sr = self.k.create(self.g(text)[0], voice=JA_VOICES[sid], speed=speed, is_phonemes=True)
        return type('Audio', (), {'samples': a, 'sample_rate': sr})


def kokoro(lang):
    k = f'{MODELS}/kokoro-multi-lang-v1_0/'
    return so.OfflineTts(so.OfflineTtsConfig(model=so.OfflineTtsModelConfig(
        kokoro=so.OfflineTtsKokoroModelConfig(
            model=k + 'model.onnx', voices=k + 'voices.bin', tokens=k + 'tokens.txt',
            data_dir=k + 'espeak-ng-data', lexicon=k + 'lexicon-us-en.txt', lang=lang),
        num_threads=6)))


def piper_de():
    p = f'{MODELS}/vits-piper-de_DE-thorsten-medium/'
    return so.OfflineTts(so.OfflineTtsConfig(model=so.OfflineTtsModelConfig(
        vits=so.OfflineTtsVitsModelConfig(
            model=p + 'de_DE-thorsten-medium.onnx', tokens=p + 'tokens.txt',
            data_dir=p + 'espeak-ng-data'),
        num_threads=6)))


def write(path, a):
    x = np.asarray(a.samples, dtype=np.float32)
    g = np.gcd(SR, a.sample_rate)
    x = ss.resample_poly(x, SR // g, a.sample_rate // g).astype(np.float32)
    x = np.concatenate([np.zeros(SR // 4, np.float32), x, np.zeros(SR // 2, np.float32)])
    sf.write(path, x, SR, subtype='PCM_16')


for lang in ['en'] + LANGS:
    os.makedirs(f'{OUT}/{lang}', exist_ok=True)
    if lang == 'de':
        tts, sids = piper_de(), [0]
    elif lang == 'ja':
        tts, sids = Japanese(), list(range(len(JA_VOICES)))
    else:
        code, sids = KOKORO[lang]
        tts = kokoro(code)
    n = 0
    for i, t in enumerate(data['turns']):
        if (lang == 'en') != (t['who'] == 'me'):
            continue
        write(f'{OUT}/{lang}/{i}.wav', tts.generate(t[lang], sid=sids[n % len(sids)], speed=1.0))
        n += 1
    if lang == 'ja':
        extra = json.load(open(os.path.join(HERE, 'hear-ja.json')))['lines']
        for j, t in enumerate(extra):
            write(f'{OUT}/ja/h{j}.wav', tts.generate(t, sid=(n + j) % len(sids), speed=1.0))
    if lang == 'en':
        for j, c in enumerate(data.get('control', [])):
            write(f'{OUT}/en/c{j}.wav', tts.generate(c['en'], sid=sids[0], speed=1.0))
    print(lang, n, flush=True)
